import expect from 'expect';
import sinon from 'sinon';

import list from './list';
import createResponse from '../utils/createResponse';
import penaltyDocuments from '../../mock-data/fake-penalty-notice.json';
import PenaltyDocument from '../services/penaltyDocuments';

describe('list', () => {

	let event;

	afterEach(() => {
		event = null;
	});

	describe('when a list of penaltyDocuments are requested', () => {
		let getDocuments;

		beforeEach(() => {
			event = {
				httpMethod: 'GET',
				pathParameters: null,
			};
			getDocuments = sinon.stub(PenaltyDocument.prototype, 'getDocuments').callsFake(async () => {
				const response = createResponse({
					body: penaltyDocuments,
				});
				return response;
			});
		});

		afterEach(() => {
			getDocuments.restore();
		});

		it('should return a 200 success', async () => {
			const res = await list(event, null);
			expect(res.statusCode).toBe(200);
		});
	});
});
