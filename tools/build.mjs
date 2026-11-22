// Builds the EquipDash n8n nodes from the same source as the EquipDash app for Make:
// ../equipdash-make-app/tools/spec.mjs. When the EquipDash API changes, change that
// spec, then run `npm run generate` here and commit what it writes.
//
// Writes:
//   nodes/EquipDash/generated/operations.ts         the action node's fields and requests
//   nodes/EquipDash/generated/loadOptions.ts        the dropdowns filled from EquipDash
//   nodes/EquipDashTrigger/generated/events.ts      the trigger's resources and events
//
// The spec's request templates (Make IML) are compiled here into plain TypeScript
// functions, so the published node evaluates no strings at run time.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPEC_DIR = process.env.EQD_MAKE_APP || path.resolve(ROOT, '..', 'equipdash-make-app');
const { modules, rpcs } = await import(pathToFileURL(path.join(SPEC_DIR, 'tools', 'spec.mjs')).href);

// ---- Where each operation goes, and its short name under its resource ------

const RESOURCES = {
	booking: 'Booking',
	bundle: 'Bundle',
	category: 'Category',
	customer: 'Customer',
	experience: 'Experience',
	giftCard: 'Gift Card',
	promoCode: 'Promo Code',
	rentalProduct: 'Rental Product',
	staff: 'Staff',
	storeProduct: 'Store Product',
	tag: 'Tag',
	waitlist: 'Waitlist',
	workshop: 'Workshop',
};

const OPS = {
	searchBookings: ['booking', 'Search'],
	getBooking: ['booking', 'Get'],
	createBooking: ['booking', 'Create'],
	updateBookingStatus: ['booking', 'Update Status'],
	addBookingPayment: ['booking', 'Add Payment'],
	addBookingNote: ['booking', 'Add Note'],
	updateBookingTags: ['booking', 'Update Tags'],
	cancelBooking: ['booking', 'Cancel'],
	searchCustomers: ['customer', 'Search'],
	getCustomer: ['customer', 'Get'],
	createCustomer: ['customer', 'Create'],
	updateCustomer: ['customer', 'Update'],
	addCustomerNote: ['customer', 'Add Note'],
	deleteCustomer: ['customer', 'Delete'],
	searchRentalProducts: ['rentalProduct', 'Search'],
	checkRentalAvailability: ['rentalProduct', 'Check Availability'],
	createRentalProduct: ['rentalProduct', 'Create'],
	updateRentalProduct: ['rentalProduct', 'Update'],
	addRentalPrice: ['rentalProduct', 'Add Price'],
	addRentalVariation: ['rentalProduct', 'Add Variation'],
	addRentalStock: ['rentalProduct', 'Add Stock'],
	archiveRentalProduct: ['rentalProduct', 'Archive'],
	searchBundles: ['bundle', 'Search'],
	searchExperiences: ['experience', 'Search'],
	searchSessions: ['experience', 'Search Sessions'],
	checkExperienceAvailability: ['experience', 'Check Availability'],
	createExperience: ['experience', 'Create'],
	updateExperience: ['experience', 'Update'],
	addSession: ['experience', 'Add Session'],
	archiveExperience: ['experience', 'Archive'],
	searchStoreProducts: ['storeProduct', 'Search'],
	getStoreProduct: ['storeProduct', 'Get'],
	createStoreProduct: ['storeProduct', 'Create'],
	updateStoreProduct: ['storeProduct', 'Update'],
	adjustStoreStock: ['storeProduct', 'Adjust Stock'],
	addStoreVariation: ['storeProduct', 'Add Variation'],
	deleteStoreProduct: ['storeProduct', 'Delete'],
	searchStaff: ['staff', 'Search'],
	createShift: ['staff', 'Create Shift'],
	sendToWorkshop: ['workshop', 'Send Item'],
	addWorkshopNote: ['workshop', 'Add Note'],
	returnFromWorkshop: ['workshop', 'Return Item'],
	searchGiftCards: ['giftCard', 'Search'],
	createGiftCard: ['giftCard', 'Create'],
	searchPromoCodes: ['promoCode', 'Search'],
	createPromoCode: ['promoCode', 'Create'],
	addToWaitlist: ['waitlist', 'Add Customer'],
	notifyWaitlistEntry: ['waitlist', 'Notify Customer'],
	createRentalCategory: ['category', 'Create Rental Category'],
	createExperienceCategory: ['category', 'Create Experience Category'],
	createTag: ['tag', 'Create'],
};
// n8n's own HTTP Request node does what Make's "Make an API call" module does, with this
// package's credential, so it is not repeated here.
const SKIP = new Set(['makeApiCall']);

// ---- Copy: the spec's words, with Make's wording swapped for n8n's ---------

const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);
const KEEP = new Set(['ID', 'IDs', 'SKU', 'URL', 'ZIP']);
const titleCase = (s) =>
	s
		.split(' ')
		.map((w, i) => (KEEP.has(w) ? w : i > 0 && SMALL.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1)))
		.join(' ');

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const help = (s) => {
	if (!s) return undefined;
	let t = escapeHtml(s)
		.replace(/\bmodules?\b/g, (m) => (m === 'modules' ? 'operations' : 'operation'))
		.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
		.replace(/`([^`]+)`/g, '<code>$1</code>')
		.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
	if (/\bMake\b/.test(t)) throw new Error(`Help text still names Make: ${s}`);
	return t;
};

// ---- IML -> TypeScript -------------------------------------------------------

const FNS = { formatDate: 'formatDate', ifempty: 'ifempty', if: 'iff', omit: 'omit', map: 'mapKey', join: 'join', length: 'len' };
const VARS = ['parameters', 'connection', 'temp', 'body', 'item', 'now', 'pagination'];

function jsExpr(expr) {
	let out = '';
	let quote = null;
	for (let i = 0; i < expr.length; i++) {
		const ch = expr[i];
		if (quote) {
			out += ch;
			if (ch === quote && expr[i - 1] !== '\\') quote = null;
			continue;
		}
		if (ch === "'" || ch === '"') {
			quote = ch;
			out += ch;
			continue;
		}
		// IML reads a missing property as empty instead of failing.
		if (ch === '.' && /[A-Za-z_]/.test(expr[i + 1] || '') && !/[0-9]/.test(expr[i - 1] || '')) {
			out += '?.';
			continue;
		}
		out += ch;
	}
	out = out.replace(/\b([A-Za-z_]\w*)\s*\(/g, (m, name, offset, str) => {
		if (str[offset - 1] === '.' || str[offset - 2] === '?') return m;
		if (!FNS[name]) throw new Error(`IML function ${name}() has no TypeScript version yet`);
		return `${FNS[name]}(`;
	});
	return out.replace(/(^|[^.\w$?])(parameters|connection|temp|body|item|now|pagination)\b/g, '$1c.$2');
}

function compile(tpl) {
	if (typeof tpl === 'string') {
		const whole = tpl.match(/^\{\{([\s\S]*)\}\}$/);
		if (whole && !whole[1].includes('{{')) return `(${jsExpr(whole[1])})`;
		if (!tpl.includes('{{')) return JSON.stringify(tpl);
		const parts = [];
		let last = 0;
		for (const m of tpl.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
			if (m.index > last) parts.push(JSON.stringify(tpl.slice(last, m.index)));
			parts.push(`str(${jsExpr(m[1])})`);
			last = m.index + m[0].length;
		}
		if (last < tpl.length) parts.push(JSON.stringify(tpl.slice(last)));
		return parts.join(' + ');
	}
	if (Array.isArray(tpl)) return `[${tpl.map(compile).join(', ')}]`;
	if (tpl && typeof tpl === 'object') {
		const entries = Object.entries(tpl).map(([k, v]) => (k === '{{...}}' ? `[null, ${compile(v)}]` : `[${JSON.stringify(k)}, ${compile(v)}]`));
		return `obj([${entries.join(', ')}])`;
	}
	return JSON.stringify(tpl);
}
const fn = (tpl) => {
	const body = compile(tpl);
	return /\bc\./.test(body) ? `(c: Ctx) => ${body}` : `() => ${body}`;
};

// The record a step answers with, as the API sent it. The Make app also parses each
// date into a Make date; n8n works with the ISO strings EquipDash sends.
function outputOf(response) {
	if (!response) return null;
	if (response.iterate) return { iterate: fn(response.iterate) };
	if (response.output) {
		const o = typeof response.output === 'string' ? response.output : response.output['{{...}}'];
		return { output: fn(o) };
	}
	return null;
}

const swapMake = (v) => {
	if (typeof v === 'string') return v === 'Make' ? 'n8n' : v;
	if (Array.isArray(v)) return v.map(swapMake);
	if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swapMake(x)]));
	return v;
};

function stepsOf(communication) {
	const list = Array.isArray(communication) ? communication : [communication];
	return list.map((raw) => {
		const s = swapMake(raw);
		const parts = [`method: ${JSON.stringify(s.method || 'GET')}`, `url: ${fn(s.url)}`];
		if (s.condition !== undefined) parts.push(`condition: ${fn(s.condition)}`);
		if (s.qs) parts.push(`qs: ${fn(s.qs)}`);
		if (s.body) parts.push(`body: ${fn(s.body)}`);
		if (s.response?.temp) parts.push(`temp: ${fn(s.response.temp)}`);
		if (s.response?.limit !== undefined) parts.push(`limit: ${fn(s.response.limit)}`);
		if (s.pagination) parts.push(`paginate: { qs: ${fn(s.pagination.qs)}, condition: ${fn(s.pagination.condition)} }`);
		const out = outputOf(s.response);
		if (out?.iterate) parts.push(`iterate: ${out.iterate}`);
		if (out?.output) parts.push(`output: ${out.output}`);
		return `{ ${parts.join(', ')} }`;
	});
}

// ---- Make parameters -> n8n properties ----------------------------------------

// Every parameter of a module, with its nested fields lifted beside it. `when` holds
// the select values that show a field nested under one option.
function flatten(params, when = {}) {
	const out = [];
	for (const p of params) {
		out.push({ ...p, when });
		if (p.nested) out.push(...flatten(p.nested, when));
		if (Array.isArray(p.options)) {
			for (const o of p.options) if (o.nested) out.push(...flatten(o.nested, { ...when, [p.name]: [o.value] }));
		}
	}
	return out;
}

const emptyDefault = (p) => {
	const m = /If left empty, (\d+(?:\.\d+)?)/.exec(p.help || '');
	return m ? Number(m[1]) : 0;
};

const rpcName = (p) => (typeof p.options === 'string' && p.options.startsWith('rpc://') ? p.options.slice(6) : null);

// A dropdown that reads another field. Inside a list row it cannot see the row's
// other fields, so there it becomes a plain ID field.
const RPC_DEPENDS = Object.fromEntries(
	rpcs.map((r) => [r.name, [...new Set([...JSON.stringify(r.communication).matchAll(/parameters\.(\w+)/g)].map((m) => m[1]))]]),
);

function property(p, { inRow = false, required = false } = {}) {
	const base = {
		displayName: titleCase(p.label),
		name: p.name,
		...(help(p.help) ? { description: help(p.help) } : {}),
		...(required ? { required: true } : {}),
	};
	const rpc = rpcName(p);
	if (rpc && !(inRow && RPC_DEPENDS[rpc].length)) {
		const depends = RPC_DEPENDS[rpc];
		const prop = {
			...base,
			displayName: `${base.displayName.replace(/ ID$/, '')} Name or ID`,
			type: p.multiple ? 'multiOptions' : 'options',
			typeOptions: { loadOptionsMethod: rpc, ...(depends.length ? { loadOptionsDependsOn: depends.flatMap((d) => [d, `additionalFields.${d}`, `filters.${d}`, `updateFields.${d}`]) } : {}) },
			default: p.multiple ? [] : '',
			description: `${base.description ? `${base.description} ` : ''}Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.`,
		};
		return prop;
	}
	if (rpc) return { ...base, type: 'number', typeOptions: { minValue: 0, numberPrecision: 0 }, default: 0 };
	switch (p.type) {
		case 'text':
			return { ...base, type: 'string', ...(p.multiline ? { typeOptions: { rows: 4 } } : {}), default: '' };
		case 'email':
			return { ...base, type: 'string', placeholder: 'name@example.com', default: '' };
		case 'uinteger':
			return { ...base, type: 'number', typeOptions: { minValue: 0, numberPrecision: 0 }, default: required ? 0 : emptyDefault(p) };
		case 'integer':
			return { ...base, type: 'number', typeOptions: { numberPrecision: 0 }, default: 0 };
		case 'number':
			return { ...base, type: 'number', typeOptions: { numberPrecision: 2 }, default: 0 };
		case 'boolean':
			return { ...base, type: 'boolean', default: false };
		case 'date':
			return { ...base, type: 'dateTime', default: '' };
		case 'select': {
			const options = p.options.map((o) => ({ name: titleCase(o.label), value: o.value }));
			if (p.multiple) return { ...base, type: 'multiOptions', options, default: [] };
			return { ...base, type: 'options', options, default: options[0].value };
		}
		case 'collection':
			return {
				...base,
				type: 'fixedCollection',
				default: {},
				options: [{ displayName: titleCase(p.label), name: 'values', values: flatten(p.spec).map((x) => property(x, { inRow: true, required: !!x.required })) }],
			};
		case 'array':
			return {
				...base,
				type: 'fixedCollection',
				typeOptions: { multipleValues: true },
				default: {},
				options: [{ displayName: titleCase(p.label), name: 'items', values: flatten(p.spec).map((x) => property(x, { inRow: true, required: !!x.required })) }],
			};
		default:
			throw new Error(`No n8n field for Make type ${p.type} (${p.name})`);
	}
}

// How execute() turns what n8n hands it back into the parameters the spec expects.
const kindOf = (p) => (p.type === 'collection' ? 'collection' : p.type === 'array' && !rpcName(p) ? 'rows' : p.type === 'date' ? 'date' : 'plain');
const rowDates = (p) => flatten(Array.isArray(p.spec) ? p.spec : []).filter((x) => x.type === 'date').map((x) => x.name);
const rowOptional = (p) => flatten(Array.isArray(p.spec) ? p.spec : []).filter((x) => !x.required).map((x) => x.name);

const props = [];
const ops = [];
const byResource = {};

for (const m of modules) {
	if (m.type === 'instant_trigger' || SKIP.has(m.name)) continue;
	const place = OPS[m.name];
	if (!place) throw new Error(`Module ${m.name} has no place in OPS: add it to tools/build.mjs`);
	const [resource, opName] = place;
	// A description that points to another Make module names the n8n operation instead.
	const description = m.description.replace(/the (.+?) module\b/g, (all, label) => {
		const other = modules.find((x) => x.label === label);
		if (!other || !OPS[other.name]) throw new Error(`No operation for the module named in: ${m.description}`);
		return `${RESOURCES[OPS[other.name][0]]} > ${OPS[other.name][1]}`;
	});
	if (/\b(Make|module)\b/.test(description)) throw new Error(`Description still names Make: ${description}`);
	(byResource[resource] ||= []).push({ name: opName, value: m.name, action: m.label, description });

	const show = { resource: [resource], operation: [m.name] };
	const isSearch = m.type === 'search';
	const optionalName = isSearch ? 'filters' : m.crud === 'update' ? 'updateFields' : 'additionalFields';
	const optionalLabel = isSearch ? 'Filters' : m.crud === 'update' ? 'Update Fields' : 'Additional Fields';

	const fields = flatten(m.params || []).filter((p) => p.name !== 'limit');
	const top = [];
	const optional = [];
	for (const p of fields) {
		const shown = Object.keys(p.when).length ? { ...show, ...p.when } : show;
		if (p.required) top.push({ ...property(p, { required: true }), displayOptions: { show: shown } });
		else if (Object.keys(p.when).length) top.push({ ...property(p), displayOptions: { show: shown } });
		else optional.push(property(p));
	}
	props.push(...top);
	if (isSearch && (m.params || []).some((p) => p.name === 'limit')) {
		props.push({
			displayName: 'Return All',
			name: 'returnAll',
			type: 'boolean',
			displayOptions: { show },
			default: false,
			description: 'Whether to return all results or only up to a given limit',
		});
		props.push({
			displayName: 'Limit',
			name: 'limit',
			type: 'number',
			displayOptions: { show: { ...show, returnAll: [false] } },
			typeOptions: { minValue: 1 },
			default: 50,
			description: 'Max number of results to return',
		});
	}
	if (optional.length) {
		props.push({
			displayName: optionalLabel,
			name: optionalName,
			type: 'collection',
			placeholder: isSearch ? 'Add Filter' : 'Add Field',
			default: {},
			displayOptions: { show },
			options: optional.sort((a, b) => a.displayName.localeCompare(b.displayName)),
		});
	}

	const comm = JSON.stringify(m.communication);
	ops.push(
		`\t${m.name}: {\n` +
			`\t\tfields: ${JSON.stringify(fields.map((p) => ({ name: p.name, kind: kindOf(p), ...(rowDates(p).length ? { dates: rowDates(p) } : {}), ...(kindOf(p) === 'rows' ? { optional: rowOptional(p) } : {}) })))},\n` +
			`\t\toptionalIn: ${JSON.stringify(optional.length ? optionalName : null)},\n` +
			`\t\tsearch: ${isSearch},\n` +
			`\t\tneedsTimezone: ${comm.includes('connection.timezone') || fields.some((p) => p.type === 'date' || rowDates(p).length)},\n` +
			`\t\tsteps: [\n\t\t\t${stepsOf(m.communication).join(',\n\t\t\t')},\n\t\t],\n` +
			`\t},`,
	);
}

const resourceProp = {
	displayName: 'Resource',
	name: 'resource',
	type: 'options',
	noDataExpression: true,
	options: Object.keys(byResource)
		.sort((a, b) => RESOURCES[a].localeCompare(RESOURCES[b]))
		.map((r) => ({ name: RESOURCES[r], value: r })),
	default: 'booking',
};
const operationProps = Object.entries(byResource)
	.sort(([a], [b]) => RESOURCES[a].localeCompare(RESOURCES[b]))
	.map(([r, list]) => {
		const options = [...list].sort((a, b) => a.name.localeCompare(b.name));
		return {
			displayName: 'Operation',
			name: 'operation',
			type: 'options',
			noDataExpression: true,
			displayOptions: { show: { resource: [r] } },
			options,
			default: (options.find((o) => o.name === 'Search') || options[0]).value,
		};
	});

const RUNTIME_FNS = ['formatDate', 'ifempty', 'iff', 'mapKey', 'join', 'len', 'obj', 'omit', 'str'];
const importsFor = (code) => RUNTIME_FNS.filter((f) => new RegExp(`\\b${f}\\(`).test(code));

const HEADER = '// Generated by tools/build.mjs from the EquipDash app for Make. Do not edit: change the spec and run `npm run generate`.\n';
const ts = (v) => JSON.stringify(v, null, '\t');

fs.mkdirSync(path.join(ROOT, 'nodes/EquipDash/generated'), { recursive: true });
const opsCode = `export const operations: Record<string, Operation> = {\n${ops.join('\n')}\n};\n`;
fs.writeFileSync(
	path.join(ROOT, 'nodes/EquipDash/generated/operations.ts'),
	HEADER +
		"import type { INodeProperties } from 'n8n-workflow';\n" +
		"import type { Ctx, Operation } from '../../shared/runtime';\n" +
		`import { ${importsFor(opsCode).join(', ')} } from '../../shared/runtime';\n\n` +
		`export const properties: INodeProperties[] = ${ts([resourceProp, ...operationProps, ...props])};\n\n` +
		opsCode,
);

// ---- Dropdowns ---------------------------------------------------------------

const lo = rpcs.map((r) => {
	const c = r.communication;
	const parts = [
		`url: ${fn(c.url)}`,
		`qs: ${fn(c.qs || {})}`,
		`iterate: ${fn(c.response.iterate)}`,
		`label: ${fn(c.response.output.label)}`,
		`value: ${fn(c.response.output.value)}`,
		`paged: ${!!c.pagination}`,
		`depends: ${JSON.stringify(RPC_DEPENDS[r.name])}`,
		`needsTimezone: ${JSON.stringify(c).includes('connection.timezone')}`,
	];
	return `\t${r.name}: { ${parts.join(', ')} },`;
});
const loCode = `export const dropdowns: Record<string, Dropdown> = {\n${lo.join('\n')}\n};\n`;
fs.writeFileSync(
	path.join(ROOT, 'nodes/EquipDash/generated/loadOptions.ts'),
	HEADER +
		"import type { Ctx, Dropdown } from '../../shared/runtime';\n" +
		`import { ${importsFor(loCode).join(', ')} } from '../../shared/runtime';\n\n` +
		loCode,
);

// ---- Trigger events ----------------------------------------------------------

const triggers = modules.filter((m) => m.type === 'instant_trigger');
const events = triggers.map((m) => ({
	name: m.webhook.label,
	value: m.webhook.name,
	description: m.description,
	events: m.webhook.events.map(([value, label]) => ({ name: titleCase(label), value })),
}));
fs.mkdirSync(path.join(ROOT, 'nodes/EquipDashTrigger/generated'), { recursive: true });
fs.writeFileSync(
	path.join(ROOT, 'nodes/EquipDashTrigger/generated/events.ts'),
	HEADER +
		'export interface WatchedResource {\n\tname: string;\n\tvalue: string;\n\tdescription: string;\n\tevents: Array<{ name: string; value: string }>;\n}\n\n' +
		`export const resources: WatchedResource[] = ${ts(events)};\n`,
);

const opCount = Object.values(byResource).reduce((n, l) => n + l.length, 0);
console.log(`EquipDash n8n: ${opCount} operations on ${Object.keys(byResource).length} resources, ${rpcs.length} dropdowns, ${events.length} trigger resources (${events.reduce((n, e) => n + e.events.length, 0)} events).`);

// ---- README: the list of operations and events -------------------------------

const readmePath = path.join(ROOT, 'README.md');
if (fs.existsSync(readmePath)) {
	const rows = Object.entries(byResource)
		.sort(([a], [b]) => RESOURCES[a].localeCompare(RESOURCES[b]))
		.map(([r, list]) => `| ${RESOURCES[r]} | ${[...list].sort((a, b) => a.name.localeCompare(b.name)).map((o) => o.name).join(', ')} |`);
	const evRows = events.map((e) => `| ${e.name} | ${e.events.map((x) => x.name).join(', ')} |`);
	const block =
		'<!-- operations:start -->\n' +
		'| Resource | Operations |\n|---|---|\n' + rows.join('\n') +
		'\n\n**EquipDash Trigger** starts a workflow when one of these happens:\n\n' +
		'| Watch | Events |\n|---|---|\n' + evRows.join('\n') +
		'\n<!-- operations:end -->';
	const readme = fs.readFileSync(readmePath, 'utf8');
	fs.writeFileSync(readmePath, readme.replace(/<!-- operations:start -->[\s\S]*<!-- operations:end -->/, block));
}
