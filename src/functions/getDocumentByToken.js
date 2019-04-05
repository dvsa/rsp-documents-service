import 'babel-polyfill';
import PenaltyDocument from '../services/penaltyDocuments';
import config from '../config';

let penaltyDocuments;
export default async (event, context, callback) => {
	if (!penaltyDocuments) {
		await config.bootstrap();
		penaltyDocuments = new PenaltyDocument(
			config.dynamodbPenaltyDocTable(),
			config.bucketName(),
			config.snsTopicArn(),
			config.siteResource(),
			config.paymentUrl(),
			config.tokenServiceArn(),
			config.daysToHold(),
			config.paymentsBatchFetchArn(),
		);
	}
	penaltyDocuments.getDocumentByToken(event.pathParameters.token, callback);
};
