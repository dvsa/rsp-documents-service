import createResponse from '../utils/createResponse';
import createErrorResponse from '../utils/createErrorResponse';
import onlyUnique from '../utils/onlyUnique';

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
			if (Items.length > 0) {
				const Penalties = Items.filter((item) => {
					return typeof !item.inPenaltyGroup && !item.Value.inPenaltyGroup;
				});
				const penaltiesInGroups = Items.filter((item) => {
					return item.inPenaltyGroup || item.Value.inPenaltyGroup;
				});
				// If there are no penalties in groups, just return the penalties
				if (penaltiesInGroups.length < 1) {
					return callback(null, createResponse({
						statusCode: 200,
						body: { Penalties, PenaltyGroups: [] },
					}));
				}
				// Otherwise, get the penalty groups
				const penaltyGroupIds = penaltiesInGroups.map(p => p.penaltyGroupId);
				this._batchGetPenaltyGroups(penaltyGroupIds)
					.then((data) => {
						const { Responses } = data;
						const PenaltyGroups = Responses[this.penaltyGroupTableName];
						return callback(null, createResponse({
							statusCode: 200,
							body: { Penalties, PenaltyGroups },
						}));
					})
					.catch((err) => {
						callback(null, createErrorResponse({ statusCode: 400, body: err }));
					});
			}
			// Return 404 not found
			return callback(null, createErrorResponse({ statusCode: 404, body: 'No penalties found' }));
		} catch (err) {
			return callback(null, createErrorResponse({ statusCode: 400, body: err }));
		}
	}
	_batchGetPenaltyGroups(ids) {
		const uniqueIds = ids.filter(onlyUnique);
		const batchGetRequestKeys = uniqueIds.map(id => ({
			ID: id,
		}));
		const batchGetParams = {
			RequestItems: {
				[this.penaltyGroupTableName]: {
					Keys: batchGetRequestKeys,
				},
			},
		};
		return this.db.batchGet(batchGetParams).promise();
	}
	_searchSinglePenalties(vehicleReg) {
		const params = {
			TableName: this.penaltyDocTableName,
			IndexName: 'ByVehicleRegistration',
			KeyConditionExpression: '#VehicleRegistration = :vehicleRegistration',
			ExpressionAttributeNames: { '#VehicleRegistration': 'VehicleRegistration' },
			ExpressionAttributeValues: { ':vehicleRegistration': vehicleReg },
		};
		return this.db.query(params).promise();
	}
}
