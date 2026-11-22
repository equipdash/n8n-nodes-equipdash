import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import type { Ctx, Operation } from '../shared/runtime';
import { CREDENTIAL, request, runSteps, shopTime, shopTimezone } from '../shared/runtime';
import { dropdowns } from './generated/loadOptions';
import { operations, properties } from './generated/operations';

const isObj = (v: unknown): v is IDataObject => !!v && typeof v === 'object' && !Array.isArray(v);

// What n8n hands back for one item, turned into the parameters the request
// templates read: optional fields lifted out of their collection, list rows and
// grouped fields unwrapped, and wall-clock dates read in the shop's time zone.
function parametersFor(self: IExecuteFunctions, op: Operation, i: number, tz: string) {
	const optional = op.optionalIn ? (self.getNodeParameter(op.optionalIn, i, {}) as IDataObject) : {};
	const params: IDataObject = {};
	for (const f of op.fields) {
		let value: unknown;
		if (f.name in optional) value = optional[f.name];
		else {
			try {
				value = self.getNodeParameter(f.name, i, undefined);
			} catch {
				// A field shown only for another choice, such as a rental field when the
				// waitlist is for a session, is not there to read.
				value = undefined;
			}
		}
		if (value === undefined) continue;
		if (f.kind === 'date') value = shopTime(value, tz);
		if (f.kind === 'collection') {
			value = isObj(value) && isObj(value.values) ? value.values : undefined;
		}
		if (f.kind === 'rows') {
			const rows = isObj(value) && Array.isArray(value.items) ? (value.items as IDataObject[]) : [];
			value = rows.map((row) => {
				const out: IDataObject = {};
				for (const [k, v] of Object.entries(row)) {
					// An optional ID or number left at 0 in a row means "not given".
					if ((f.optional || []).includes(k) && (v === 0 || v === '')) continue;
					out[k] = (f.dates || []).includes(k) ? (shopTime(v, tz) as IDataObject[string]) : v;
				}
				return out;
			});
			if (!(value as unknown[]).length) value = undefined;
		}
		if (value === undefined) continue;
		params[f.name] = value as IDataObject[string];
	}
	return params;
}

export class EquipDash implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'EquipDash',
		name: 'equipDash',
		icon: { light: 'file:../../icons/equipdash.svg', dark: 'file:../../icons/equipdash.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Bookings, customers, rentals, experiences and more in EquipDash',
		defaults: {
			name: 'EquipDash',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: CREDENTIAL, required: true }],
		properties,
	};

	methods = {
		loadOptions: Object.fromEntries(
			Object.entries(dropdowns).map(([name, d]) => [
				name,
				async function (this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
					const parameters: IDataObject = {};
					for (const dep of d.depends) {
						let v = this.getCurrentNodeParameter(dep);
						for (const group of ['additionalFields', 'filters', 'updateFields']) {
							if (v !== undefined && v !== '' && v !== null) break;
							const g = this.getCurrentNodeParameter(group);
							if (isObj(g)) v = (g as IDataObject)[dep] as typeof v;
						}
						if (v === undefined || v === '' || v === null) return [];
						parameters[dep] = v as IDataObject[string];
					}
					const ctx: Ctx = {
						parameters,
						now: new Date(),
						connection: { timezone: d.needsTimezone ? await shopTimezone(this) : 'UTC' },
					};
					const options: INodePropertyOptions[] = [];
					for (let page = 1; page <= 3; page++) {
						const qs = { ...d.qs(ctx), ...(d.paged ? { per_page: 100, page } : {}) };
						const res = await request(this, 'GET', String(d.url(ctx)), qs);
						const items = (d.iterate({ ...ctx, body: res.body }) as IDataObject[]) || [];
						for (const item of items) {
							options.push({ name: String(d.label({ ...ctx, item })), value: d.value({ ...ctx, item }) as string | number });
						}
						const meta = isObj(res.body) && isObj(res.body.meta) ? res.body.meta : {};
						if (!d.paged || !(Number(meta.current_page) < Number(meta.total_pages))) break;
					}
					return options;
				},
			]),
		),
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		let timezone: string | undefined;

		for (let i = 0; i < items.length; i++) {
			try {
				const name = this.getNodeParameter('operation', i) as string;
				const op = operations[name];
				if (!op) throw new NodeOperationError(this.getNode(), `Unknown operation: ${name}`, { itemIndex: i });
				if (op.needsTimezone && timezone === undefined) timezone = await shopTimezone(this);
				const tz = timezone || 'UTC';
				const parameters = parametersFor(this, op, i, tz);
				if (op.search) {
					const returnAll = this.getNodeParameter('returnAll', i, false) as boolean;
					parameters.limit = returnAll ? 0 : (this.getNodeParameter('limit', i, 50) as number);
				}
				const result = await runSteps(this, op.steps, { parameters, connection: { timezone: tz }, now: new Date() });
				const rows = Array.isArray(result) ? result : [result === undefined || result === null || result === '' ? { success: true } : result];
				for (const row of rows) {
					returnData.push({ json: (isObj(row) ? row : { value: row }) as IDataObject, pairedItem: { item: i } });
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				if (error instanceof NodeApiError) {
					error.context.itemIndex = i;
					throw new NodeApiError(this.getNode(), error.errorResponse ?? { message: error.message }, {
						message: error.message,
						httpCode: error.httpCode ?? undefined,
						itemIndex: i,
					});
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}
		return [returnData];
	}
}
