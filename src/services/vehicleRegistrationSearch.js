import createResponse from '../utils/createResponse';
import createErrorResponse from '../utils/createErrorResponse';

export default class VehicleRegistrationSearch {
	constructor(db, penaltyDocTableName, penaltyGroupTableName) {
		this.db = db;
		this.penaltyDocTableName = penaltyDocTableName;
		this.penaltyGroupTableName = penaltyGroupTableName;
	}
	async search(vehicleReg, callback) {
		let data;
		try {
			// Check in penalty groups first
			data = await this._searchPenaltyGroups(vehicleReg);
			console.log('pen group data');
			console.log(data);
			if (data.Items.length > 0) {
				return callback(null, createResponse({ statusCode: 200, body: data.Items }));
			}
			// Check in single penalties next
			data = await this._searchSinglePenalties(vehicleReg);
			console.log('single pen data');
			console.log(data);
			if (data.Items.length > 0) {
				return callback(null, createResponse({ statusCode: 200, body: data.Items }));
			}
			// Return 404 not found
			return callback(null, createResponse({ statusCode: 404, body: 'No penalties found' }));
		} catch (err) {
			return callback(null, createErrorResponse({ statusCode: 400, body: err }));
		}
	}
	async _searchPenaltyGroups(vehicleReg) {
		const params = {
			TableName: this.penaltyGroupTableName,
			IndexName: 'VehicleRegistration',
			KeyConditionExpression: 'VehicleRegistration = :value',
			ExpressionAttributeValues: { ':value': vehicleReg },
		};
		try {
			const data = await this.db.query(params).promise();
			return data;
		} catch (err) {
			return err;
		}
	}
	async _searchSinglePenalties(vehicleReg) {
		const params = {
			TableName: this.penaltyDocTableName,
			FilterExpression: '#Value.#vehicleDetails.#regNo = :value', // a string representing a constraint on the attribute
			ExpressionAttributeNames: { // a map of substitutions for attribute names
				'#Value': 'Value',
				'#vehicleDetails': 'vehicleDetails',
				'#regNo': 'regNo',
			},
			ExpressionAttributeValues: { // a map of substitutions for all attribute values
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
