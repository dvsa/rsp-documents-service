import '@babel/polyfill';
import { doc } from 'serverless-dynamodb-client';
import VehicleRegistrationSearch from '../services/vehicleRegistrationSearch';
import config from '../config';

let vehicleRegistrationSearch;
export default async (event) => {
	if (!vehicleRegistrationSearch) {
		await config.bootstrap();
		vehicleRegistrationSearch = new VehicleRegistrationSearch(
			doc,
			config.dynamodbPenaltyDocTable(),
			config.dynamodbPenaltyGroupTable(),
		);
	}
	return vehicleRegistrationSearch.search(decodeURI(event.pathParameters.vehicleReg));
};
