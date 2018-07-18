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
		const { UserID, Timestamp, Penalties } = body;
		const generatedId = `${Timestamp}${UserID}`.replace(/\D/g, '');
		body.ID = generatedId;

		const unixTime = getUnixTime();
		const groupPutRequest = {
			PutRequest: {
				Item: {
					ID: generatedId,
					PenaltyDocumentIds: Penalties.map(p => p.ID),
				},
			},
		};

		const penaltyPutRequests = Penalties.map(p => ({
			PutRequest: {
				Item: {
					ID: p.ID,
					Value: p.Value,
					Enabled: p.Enabled,
					Origin: p.Origin || appOrigin,
					Hash: hashToken(p.ID, p.Value, p.Enabled),
					Offset: unixTime,
				},
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
			callback(null, createResponse({ statusCode: 201, body }));
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

}
