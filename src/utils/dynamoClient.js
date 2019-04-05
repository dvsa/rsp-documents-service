import { DynamoDB } from 'aws-sdk';

const dynamoClient = (() => {
	return process.env.IS_OFFLINE
		? new DynamoDB.DocumentClient({ endpoint: 'http://localhost:8000' })
		: new DynamoDB.DocumentClient();
})();

export default dynamoClient;
