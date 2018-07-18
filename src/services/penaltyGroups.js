/* eslint class-methods-use-this: "off" */
/* eslint-env es6 */

import createResponse from '../utils/createResponse';
import getUnixTime from '../utils/time';
import hashToken from '../utils/hash';

const appOrigin = 'APP';

export default class PenaltyGroup {

	constructor(db, penaltyDocTableName, penaltyGroupTableName) {
		this.db = db;
		this.penaltyDocTableName = penaltyDocTableName;
		this.penaltyGroupTableName = penaltyGroupTableName;
	}

	createPenaltyGroup(body, callback) {
		const penGrp = { ...body };
		const { UserID, Timestamp, Penalties } = penGrp;
		const generatedId = `${Timestamp}${UserID}`.replace(/\D/g, '');
		penGrp.ID = generatedId;
		penGrp.TotalAmount = body.Penalties.reduce((total, pen) => pen.Value.penaltyAmount + total, 0);
		penGrp.PaymentStatus = 'UNPAID';
		penGrp.Penalties.forEach((p) => {
			p.inPenaltyGroup = true;
			p.Hash = hashToken(p.ID, p.Value, p.Enabled);
			p.Origin = p.Origin || appOrigin;
			p.Offset = getUnixTime();
		});

		const groupPutRequest = {
			PutRequest: {
				Item: this.createPersistablePenaltyGroup(penGrp),
			},
		};

		const penaltyPutRequests = Penalties.map(p => ({
			PutRequest: {
				Item: p,
			},
		}));

		const requestItems = {};
		requestItems[this.penaltyDocTableName] = penaltyPutRequests;
		requestItems[this.penaltyGroupTableName] = [groupPutRequest];

		const batchParams = {
			RequestItems: requestItems,
		};

		const dbPutPromise = this.db.batchWrite(batchParams).promise();
		dbPutPromise.then(() => {
			callback(null, createResponse({ statusCode: 201, body: penGrp }));
		}).catch((err) => {
			callback(null, createResponse({ statusCode: 500, body: `insert failed: ${err}` }));
		});
	}

	async getPenaltyGroup(penaltyGroupId, callback) {
		const groupParams = {
			TableName: this.penaltyGroupTableName,
			Key: { ID: penaltyGroupId },
		};

		try {
			const penaltyGroupPromise = this.db.get(groupParams).promise();
			const penaltyGrpContainer = await penaltyGroupPromise;
			if (penaltyGrpContainer.Item) {
				const penaltyDocIds = penaltyGrpContainer.Item.PenaltyDocumentIds;

				const requestItems = penaltyDocIds.map(docId => ({
					ID: docId,
				}));
				const penaltyDocumentParams = { RequestItems: {} };
				penaltyDocumentParams.RequestItems[this.penaltyDocTableName] = { Keys: requestItems };
				const penaltyDocPromise = this.db.batchGet(penaltyDocumentParams).promise();

				const penaltyDocItemContainer = await penaltyDocPromise;

				const resp = penaltyGrpContainer.Item;
				resp.Penalties = penaltyDocItemContainer.Responses.penaltyDocuments;
				delete resp.PenaltyDocumentIds;

				callback(null, createResponse({ statusCode: 200, body: resp }));
			} else {
				callback(null, createResponse({ statusCode: 404, body: { error: 'ITEM NOT FOUND' } }));
			}
		} catch (err) {
			callback(null, createResponse({ statusCode: 503, body: err }));
		}
	}

	createPersistablePenaltyGroup(penaltyGroup) {
		const persistableGrp = { ...penaltyGroup };
		persistableGrp.PenaltyDocumentIds = persistableGrp.Penalties.map(p => p.ID);
		delete persistableGrp.Penalties;
		return persistableGrp;
	}

}
