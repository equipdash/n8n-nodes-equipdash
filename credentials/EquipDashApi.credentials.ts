import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class EquipDashApi implements ICredentialType {
	name = 'equipDashApi';

	displayName = 'EquipDash API';

	icon: Icon = { light: 'file:../icons/equipdash.svg', dark: 'file:../icons/equipdash.dark.svg' };

	documentationUrl = 'https://equipdash.com/help/settings/api/creating-keys';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			description:
				'In EquipDash, go to <b>Settings &gt; API &amp; Integrations</b>, click <b>Create API key</b>, click <b>Select All</b> and copy the key',
		},
		{
			displayName: 'EquipDash URL',
			name: 'domain',
			type: 'string',
			default: 'https://app.equipdash.com',
			description: 'Leave this as it is unless EquipDash support gives you another address',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.domain.replace(/\\/+$/, "")}}/api/v1',
			url: '/settings',
			method: 'GET',
			headers: { Accept: 'application/json' },
		},
	};
}
