import { createHmac, timingSafeEqual } from 'crypto';
import type {
	IDataObject,
	IHookFunctions,
	INodeProperties,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes } from 'n8n-workflow';
import { CREDENTIAL, request } from '../shared/runtime';
import { resources } from './generated/events';

const isObj = (v: unknown): v is IDataObject => !!v && typeof v === 'object' && !Array.isArray(v);

const eventFields: INodeProperties[] = resources.map((r) => ({
	displayName: 'Events',
	name: 'events',
	type: 'multiOptions',
	required: true,
	displayOptions: { show: { resource: [r.value] } },
	options: r.events,
	default: [r.events[0].value],
	description: 'The events that start the workflow',
}));

export class EquipDashTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'EquipDash Trigger',
		name: 'equipDashTrigger',
		icon: { light: 'file:../../icons/equipdash.svg', dark: 'file:../../icons/equipdash.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["resource"]}}',
		description: 'Starts the workflow when something happens in EquipDash, such as a new booking',
		defaults: {
			name: 'EquipDash Trigger',
		},
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: CREDENTIAL, required: true }],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: resources.map((r) => ({ name: r.name, value: r.value, description: r.description })),
				default: 'bookings',
			},
			...eventFields,
		],
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const data = this.getWorkflowStaticData('node');
				if (data.webhookId === undefined) return false;
				const res = await request(this, 'GET', `/webhooks/${data.webhookId}`, undefined, undefined, true);
				if (res.statusCode !== 404) {
					const hook = isObj(res.body) && isObj(res.body.data) ? res.body.data : {};
					const events = (this.getNodeParameter('events') as string[]) || [];
					const sameUrl = hook.url === this.getNodeWebhookUrl('default');
					const sameEvents = Array.isArray(hook.events) && hook.events.length === events.length && events.every((e) => (hook.events as string[]).includes(e));
					if (sameUrl && sameEvents) return true;
					// The workflow now watches other events or has a new address: start again.
					await request(this, 'DELETE', `/webhooks/${data.webhookId}`, undefined, undefined, true);
				}
				delete data.webhookId;
				delete data.secret;
				return false;
			},
			async create(this: IHookFunctions): Promise<boolean> {
				const resource = this.getNodeParameter('resource') as string;
				const label = resources.find((r) => r.value === resource)?.name || resource;
				const res = await request(this, 'POST', '/webhooks', undefined, {
					name: `n8n: ${label}`,
					url: this.getNodeWebhookUrl('default'),
					events: this.getNodeParameter('events') as string[],
				});
				const hook = isObj(res.body) && isObj(res.body.data) ? res.body.data : {};
				if (hook.id === undefined) {
					throw new NodeApiError(this.getNode(), { message: 'EquipDash did not return the new webhook' });
				}
				const data = this.getWorkflowStaticData('node');
				data.webhookId = hook.id;
				data.secret = hook.secret;
				return true;
			},
			async delete(this: IHookFunctions): Promise<boolean> {
				const data = this.getWorkflowStaticData('node');
				if (data.webhookId === undefined) return true;
				// A webhook already removed in EquipDash answers 404: nothing left to delete.
				await request(this, 'DELETE', `/webhooks/${data.webhookId}`, undefined, undefined, true);
				delete data.webhookId;
				delete data.secret;
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const req = this.getRequestObject();
		const body = this.getBodyData();
		const secret = this.getWorkflowStaticData('node').secret as string | undefined;
		const raw = (req as unknown as { rawBody?: Buffer }).rawBody;
		const sent = String(this.getHeaderData()['x-equipdash-signature'] || '');
		// EquipDash signs each delivery with the webhook's secret. Refuse one that is
		// not signed by it.
		if (secret && raw) {
			const want = createHmac('sha256', secret).update(raw).digest('hex');
			const ok = sent.length === want.length && timingSafeEqual(Buffer.from(sent), Buffer.from(want));
			if (!ok) {
				this.getResponseObject().status(401).send('Signature does not match');
				return { noWebhookResponse: true };
			}
		}
		// A test delivery sent from EquipDash's webhook settings carries no record.
		if (body.event === 'test') return {};
		const record = isObj(body.data) ? body.data : {};
		return {
			workflowData: [
				this.helpers.returnJsonArray({
					...record,
					event: body.event,
					event_id: body.id,
					event_time: body.created_at,
				}),
			],
		};
	}
}
