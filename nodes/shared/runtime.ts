import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	IWebhookFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

// The values a compiled request template reads: the operation's parameters, the
// shop's time zone, data saved by an earlier step, and the answer being read.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Ctx = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Template = (c: Ctx) => any;

export interface Step {
	method: string;
	url: Template;
	condition?: Template;
	qs?: Template;
	body?: Template;
	temp?: Template;
	limit?: Template;
	paginate?: { qs: Template; condition: Template };
	iterate?: Template;
	output?: Template;
}

export interface Field {
	name: string;
	kind: 'plain' | 'date' | 'collection' | 'rows';
	dates?: string[];
	optional?: string[];
}

export interface Operation {
	fields: Field[];
	optionalIn: string | null;
	search: boolean;
	needsTimezone: boolean;
	steps: Step[];
}

export interface Dropdown {
	url: Template;
	qs: Template;
	iterate: Template;
	label: Template;
	value: Template;
	paged: boolean;
	depends: string[];
	needsTimezone: boolean;
}

export const CREDENTIAL = 'equipDashApi';
const MAX_PAGES = 50;

// ---- The functions the request templates use ----------------------------------

const isObj = (v: unknown): v is IDataObject => !!v && typeof v === 'object' && !Array.isArray(v);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const iff = (c: unknown, a: any, b: any) => (c ? a : b);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ifempty = (v: any, alt: any) => (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length) ? alt : v);
export const str = (v: unknown) => (v === undefined || v === null ? '' : String(v));
export const omit = (o: unknown, ...keys: string[]) => {
	const out: IDataObject = { ...(isObj(o) ? o : {}) };
	for (const k of keys) delete out[k];
	return out;
};
export const mapKey = (arr: unknown, key: string) => (Array.isArray(arr) ? arr.map((x) => (isObj(x) ? x[key] : x)) : []);
export const join = (arr: unknown, sep: string) => (Array.isArray(arr) ? arr.join(sep) : '');
export const len = (v: unknown) => (v && typeof v === 'object' && 'length' in v ? (v as { length: number }).length : 0);
// Builds an object the way a template reads: [null, value] spreads value in, and keys
// whose value is undefined are left out.
export const obj = (entries: Array<[string | null, unknown]>) => {
	const out: IDataObject = {};
	for (const [k, v] of entries) {
		if (k === null) {
			if (isObj(v)) Object.assign(out, v);
		} else if (v !== undefined) out[k] = v as IDataObject[string];
	}
	return out;
};

function zoneParts(d: Date, tz: string) {
	const parts: Record<string, string> = {};
	for (const p of new Intl.DateTimeFormat('en-US', {
		timeZone: tz || 'UTC',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hourCycle: 'h23',
	}).formatToParts(d)) {
		parts[p.type] = p.value;
	}
	return parts;
}

// formatDate(value, 'YYYY-MM-DD', 'Europe/London'), as the Make app's templates use it.
// An empty value stays empty, so an erased field reaches the API as empty.
export function formatDate(value: unknown, fmt?: string, tz?: string) {
	if (value === undefined || value === null || value === '') return '';
	const d = value instanceof Date ? value : new Date(value as string);
	if (isNaN(d.getTime())) return '';
	if (!fmt) return d.toISOString();
	const p = zoneParts(d, tz || 'UTC');
	const local = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
	const off = Math.round((local - Math.floor(d.getTime() / 1000) * 1000) / 60000);
	const zone = `${off < 0 ? '-' : '+'}${String(Math.floor(Math.abs(off) / 60)).padStart(2, '0')}:${String(Math.abs(off) % 60).padStart(2, '0')}`;
	const tokens: Record<string, string> = { YYYY: p.year, MM: p.month, DD: p.day, HH: p.hour, mm: p.minute, ss: p.second, Z: zone };
	return fmt.replace(/YYYY|MM|DD|HH|mm|ss|Z/g, (t) => tokens[t]);
}

// n8n's date picker gives a wall-clock time with no zone, such as 2026-07-04T10:00:00.
// Read that in the shop's time zone, as the field's help says. A value that names
// its zone or offset keeps it.
export function shopTime(value: unknown, tz: string) {
	if (typeof value !== 'string' || value === '') return value;
	const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?$/.exec(value.trim());
	if (!m) return value;
	const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
	let guess = wall;
	for (let i = 0; i < 2; i++) {
		const p = zoneParts(new Date(guess), tz || 'UTC');
		const asWall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
		guess += wall - asWall;
	}
	return new Date(guess).toISOString();
}

// ---- Requests ---------------------------------------------------------------------

type Ctx_ = IExecuteFunctions | ILoadOptionsFunctions | IHookFunctions | IWebhookFunctions;

// The API leaves out a key sent empty, as Make does.
function clean(v: unknown): unknown {
	if (Array.isArray(v)) return v.map(clean);
	if (isObj(v)) {
		const o: IDataObject = {};
		for (const [k, x] of Object.entries(v)) if (x !== undefined && x !== '') o[k] = clean(x) as IDataObject[string];
		return o;
	}
	return v;
}

export async function apiBase(self: Ctx_) {
	const cred = await self.getCredentials(CREDENTIAL);
	return `${String(cred.domain || 'https://app.equipdash.com').replace(/\/+$/, '')}/api/v1`;
}

// One call to the EquipDash API. A refusal becomes an n8n error that says what
// EquipDash said, and each field it refused.
export async function request(self: Ctx_, method: string, path: string, qs?: IDataObject, body?: IDataObject, allowNotFound = false) {
	const base = await apiBase(self);
	const query: IDataObject = {};
	for (const [k, v] of Object.entries((clean(qs || {}) as IDataObject) || {})) query[k] = Array.isArray(v) ? v.join(',') : v;
	const options: IHttpRequestOptions = {
		method: method.toUpperCase() as IHttpRequestMethods,
		url: /^https?:/.test(path) ? path : `${base}/${path.replace(/^\/+/, '').replace(/\/{2,}/g, '/')}`,
		qs: query,
		headers: { Accept: 'application/json' },
		json: true,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
	};
	if (body !== undefined && options.method !== 'GET') options.body = clean(body) as IDataObject;
	const res = (await self.helpers.httpRequestWithAuthentication.call(self, CREDENTIAL, options)) as {
		statusCode: number;
		body: IDataObject | string | undefined;
	};
	const answer = typeof res.body === 'string' && res.body !== '' ? safeJson(res.body) : res.body;
	if (allowNotFound && res.statusCode === 404) return { statusCode: 404, body: answer };
	if (res.statusCode >= 400) {
		const err = isObj(answer) && isObj(answer.error) ? (answer.error as IDataObject) : {};
		const details = Array.isArray(err.details)
			? (err.details as IDataObject[])
					.map((d) => (isObj(d) ? d.message : d))
					.filter(Boolean)
					.join(' ')
			: '';
		const message =
			res.statusCode === 401
				? 'EquipDash did not accept this API key. Check that you copied all of it, or create a new one.'
				: `${String(err.message || 'EquipDash could not complete the request.')}${details ? ` ${details}` : ''}`;
		throw new NodeApiError(self.getNode(), (isObj(answer) ? answer : { message }) as JsonObject, {
			message,
			httpCode: String(res.statusCode),
		});
	}
	return { statusCode: res.statusCode, body: answer };
}

function safeJson(s: string) {
	try {
		return JSON.parse(s);
	} catch {
		return s;
	}
}

// The shop's time zone, read once per run. Days and clock times are sent in it.
export async function shopTimezone(self: Ctx_) {
	const res = await request(self, 'GET', '/settings');
	const data = isObj(res.body) && isObj(res.body.data) ? (res.body.data as IDataObject) : {};
	const loc = isObj(data.localization) ? (data.localization as IDataObject) : {};
	return String(loc.timezone || 'UTC');
}

// Runs an operation's steps the way the Make app runs them: each step's condition,
// data one step saves for the next, the list a search reads, its limit and its pages.
export async function runSteps(self: Ctx_, steps: Step[], ctx: Ctx) {
	let result: unknown;
	ctx = { ...ctx, temp: {} };
	for (const step of steps) {
		if (step.condition && !step.condition(ctx)) continue;
		const limitRaw = step.limit ? Number(step.limit(ctx)) : Infinity;
		const limit = limitRaw > 0 ? limitRaw : Infinity;
		const out: unknown[] = [];
		for (let page = 1; ; page++) {
			const pctx = { ...ctx, pagination: { page } };
			const qs = { ...(step.qs ? step.qs(pctx) : {}), ...(page > 1 && step.paginate ? step.paginate.qs(pctx) : {}) };
			const res = await request(self, step.method, String(step.url(pctx)), qs, step.body ? step.body(pctx) : undefined);
			const rctx = { ...pctx, body: res.body, statusCode: res.statusCode };
			if (step.temp) ctx.temp = { ...ctx.temp, ...step.temp(rctx) };
			if (!step.iterate) {
				result = step.output ? step.output(rctx) : res.body;
				break;
			}
			const items = (step.iterate(rctx) as unknown[]) || [];
			for (const item of items) {
				if (out.length >= limit) break;
				out.push(item);
			}
			const more = step.paginate && items.length && out.length < limit && step.paginate.condition(rctx);
			result = out;
			if (!more || page >= MAX_PAGES) break;
		}
	}
	return result;
}
