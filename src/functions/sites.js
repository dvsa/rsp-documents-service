import { doc } from '../utils/dynamodb';
import PenaltyDocument from '../services/penaltyDocuments';
import config from '../config';

let penaltyDocuments;

export const handler = async () => {
	if (!penaltyDocuments) {
		await config.bootstrap();
		penaltyDocuments = new PenaltyDocument(
			doc,
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
	return penaltyDocuments.getSites();
};

export default handler;
