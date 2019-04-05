import 'babel-polyfill';
import VehicleRegistrationSearch from '../services/vehicleRegistrationSearch';
import config from '../config';

let vehicleRegistrationSearch;
export default async (event, context, callback) => {
	if (!vehicleRegistrationSearch) {
		await config.bootstrap();
		vehicleRegistrationSearch = new VehicleRegistrationSearch(
			config.dynamodbPenaltyDocTable(),
			config.dynamodbPenaltyGroupTable(),
		);
	}
	vehicleRegistrationSearch.search(decodeURI(event.pathParameters.vehicleReg), callback);
};
