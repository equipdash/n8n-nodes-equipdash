# n8n-nodes-equipdash

n8n nodes for [EquipDash](https://equipdash.com), booking software for rental shops, tours, classes and activities.

- **EquipDash** works with bookings, customers, rental products, experiences and their sessions, store products, staff shifts, the workshop, gift cards, promo codes and the waitlist. It also works as a tool for an n8n AI Agent.
- **EquipDash Trigger** starts a workflow when something happens in EquipDash, such as a new booking, a payment or a signed waiver.

[Installation](#installation) · [Credentials](#credentials) · [Operations](#operations) · [Example workflows](#example-workflows) · [Use with an AI Agent](#use-with-an-ai-agent) · [Compatibility](#compatibility) · [Resources](#resources)

## Installation

In n8n, go to **Settings > Community Nodes**, click **Install**, enter `n8n-nodes-equipdash` and confirm.

For other ways to install, see the [n8n community nodes guide](https://docs.n8n.io/integrations/community-nodes/installation/).

## Credentials

The nodes connect with an EquipDash API key.

1. In EquipDash, go to **Settings > API & Integrations**.
2. Click **Create API key**, click **Select All** and save.
3. Copy the key. EquipDash shows it only once.
4. In n8n, create an **EquipDash API** credential and paste the key into **API Key**. Leave **EquipDash URL** as it is.

n8n checks the key when you save the credential. For more on API keys, see the [EquipDash guide to API keys](https://equipdash.com/help/settings/api/creating-keys).

## Operations

<!-- operations:start -->
| Resource | Operations |
|---|---|
| Booking | Add Note, Add Payment, Cancel, Create, Get, Search, Update Status, Update Tags |
| Bundle | Search |
| Category | Create Experience Category, Create Rental Category |
| Customer | Add Note, Create, Delete, Get, Search, Update |
| Experience | Add Session, Archive, Check Availability, Create, Search, Search Sessions, Update |
| Gift Card | Create, Search |
| Promo Code | Create, Search |
| Rental Product | Add Price, Add Stock, Add Variation, Archive, Check Availability, Create, Search, Update |
| Staff | Create Shift, Search |
| Store Product | Add Variation, Adjust Stock, Create, Delete, Get, Search, Update |
| Tag | Create |
| Waitlist | Add Customer, Notify Customer |
| Workshop | Add Note, Return Item, Send Item |

**EquipDash Trigger** starts a workflow when one of these happens:

| Watch | Events |
|---|---|
| Bookings | New Booking, Booking Changed, Booking Canceled, Booking Completed, Rental Picked Up, Rental Returned, Customer Checked in, Marked as a No-show, Status Changed |
| Payments | Payment Received, Payment Refunded, Balance Reminder Sent |
| Customers | New Customer, Customer Changed, Customer Deleted |
| Rental products | New Rental Product, Rental Product Changed, Rental Product Archived |
| Rental stock | Stock Added, Stock Changed, Stock Removed |
| Experiences | New Experience, Experience Changed, Experience Archived |
| Sessions | New Session, Session Changed, Session Deleted |
| Staff shifts | New Shift, Shift Changed, Shift Published, Shift Deleted |
| Workshop | Item Sent to the Workshop, Item Back from the Workshop |
| Store products | New Store Product, Store Product Changed, Stock Running Low, Stock Changed by Hand, Stock Moved Between Locations |
| Form responses | Waiver or Form Submitted |
| Survey responses | Survey Answered |
| Gift cards | Gift Card Sold, Gift Card Used |
| Promo codes | New Promo Code, Promo Code Changed |
| Bundles | New Bundle |
| Waitlist | New Waitlist Entry |
<!-- operations:end -->

Dates and times you type into a date field are read in the shop's time zone, the same as in EquipDash. A value that already has a time zone or a `Z` keeps it.

To call an EquipDash endpoint these nodes do not cover, use n8n's **HTTP Request** node with **Authentication** set to **Predefined Credential Type** and **EquipDash API**. The [EquipDash API reference](https://api-docs.equipdash.com) lists every endpoint.

## Example workflows

**Send new bookings to a team chat**

1. **EquipDash Trigger**: Watch **Bookings**, event **New Booking**.
2. A chat node (Slack, Microsoft Teams, Discord) posts the customer's name, `start_date` and `total`.

**Add customers from a web form**

1. A form or webhook node receives a name and email.
2. **EquipDash**: **Customer > Search** on the email.
3. An **If** node checks whether a customer came back.
4. **EquipDash**: **Customer > Create** when none was found.

**Follow up after a rental is returned**

1. **EquipDash Trigger**: Watch **Bookings**, event **Rental Returned**.
2. **EquipDash**: **Booking > Add Note** to record that a review request went out.
3. An email node sends the customer a thank-you with a review link.

## Use with an AI Agent

The **EquipDash** node can be connected to an n8n **AI Agent** as a tool. Add the node under the agent's **Tool** connection, choose a resource and operation, and let the model fill the fields with `$fromAI()`. For example, an agent with **Experience > Search Sessions** and **Booking > Create** can answer "Is there room for 2 people on Saturday morning?" and then book it.

Give the agent only the operations it needs. An agent that can cancel bookings or delete customers can do that for real.

## Compatibility

Built and tested with n8n 2.48.

## Development

Every operation, field and event in this package is generated from the same source as the EquipDash app for Make, so a change to the EquipDash API is made once. After changing that source:

```bash
npm run generate   # rewrites nodes/*/generated/*.ts and the Operations table above
npm run lint
npm run build
```

`npm run generate` expects the EquipDash app for Make in `../equipdash-make-app`, or in the folder named by `EQD_MAKE_APP`. The generated files are committed, so building or publishing does not need it.

Releases are published to npm from GitHub Actions with provenance (`.github/workflows/publish.yml`) when a version tag is pushed. Run `npm run release` to bump the version, tag and push.

## Resources

- [EquipDash](https://equipdash.com)
- [EquipDash API reference](https://api-docs.equipdash.com)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)

Questions or problems: support@equipdash.com

## License

[MIT](LICENSE.md)
