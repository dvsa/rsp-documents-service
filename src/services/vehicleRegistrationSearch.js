import createResponse from '../utils/createResponse';
import createErrorResponse from '../utils/createErrorResponse';

export default class VehicleRegistrationSearch {
	constructor(db, penaltyDocTableName, penaltyGroupTableName) {
		this.db = db;
		this.penaltyDocTableName = penaltyDocTableName;
		this.penaltyGroupTableName = penaltyGroupTableName;
	}
	async search(vehicleReg, callback) {
		try {
			// Check in single penalties first
			const { Items } = await this._searchSinglePenalties(vehicleReg);
			console.log('single pen data');
			console.log(Items);
			if (Items.length > 0) {
				const Penalties = Items.filter((item) => {
					return typeof item.inPenaltyGroup === 'undefined' && typeof item.Value.inPenaltyGroup === 'undefined';
				});
				const penaltiesInGroups = Items.filter((item) => {
					return item.inPenaltyGroup || item.Value.inPenaltyGroup;
				});
				console.log('Penalties');
				console.log(Penalties);
				// If there no penalties in groups, just return the penalties
				if (penaltiesInGroups.length < 1) {
					return callback(null, createResponse({
						statusCode: 200,
						body: { Penalties, PenaltyGroups: [] },
					}));
				}
				// Otherwise, get the penalty groups
				const penaltyGroupIds = penaltiesInGroups.map(p => p.Value.penaltyGroupId);
				const data = await this._batchGetPenaltyGroups(penaltyGroupIds);
				const PenaltyGroups = data.Responses[this.penaltyGroupTableName];
				console.log('pen group data');
				console.log(data);
				return callback(null, createResponse({
					statusCode: 200,
					body: { Penalties, PenaltyGroups },
				}));
			}
			// Return 404 not found
			return callback(null, createResponse({ statusCode: 404, body: 'No penalties found' }));
		} catch (err) {
			return callback(null, createErrorResponse({ statusCode: 400, body: err }));
		}
	}
	async _batchGetPenaltyGroups(ids) {
		const batchGetParams = {
			RequestItems: {
				[this.penaltyGroupTableName]: {
					Keys: ids.map(id => ({ ID: id })),
				},
			},
		};
		try {
			const data = await this.db.batchGet(batchGetParams).promise();
			return data;
		} catch (err) {
			return err;
		}
	}
	async _searchSinglePenalties(vehicleReg) {
		const params = {
			TableName: this.penaltyDocTableName,
			FilterExpression: '#Value.#vehicleDetails.#regNo = :value',
			ExpressionAttributeNames: {
				'#Value': 'Value',
				'#vehicleDetails': 'vehicleDetails',
				'#regNo': 'regNo',
			},
			ExpressionAttributeValues: {
				':value': vehicleReg,
			},
		};
		try {
			const data = await this.db.scan(params).promise();
			return data;
		} catch (err) {
			return err;
		}
	}
}
