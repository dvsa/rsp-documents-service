import expect from 'expect';
import sinon from 'sinon';

import get from './get';
import createResponse from '../utils/createResponse';
import penaltyDocuments from '../../mock-data/fake-penalty-notice.json';
import PenaltyDocument from '../services/penaltyDocuments';

describe('get', () => {

	let event;
	let penaltyDocument;

	afterEach(() => {
		event = null;
	});

	describe('when a specific penaltyDocument is requested', () => {

		beforeEach(() => {
			event = {
				httpMethod: 'GET',
				pathParameters: {
					id: '123456669966_FPN',
				},
			};
			penaltyDocument = penaltyDocuments.filter((item) => item.ID === '123456669966_FPN');
			sinon.stub(PenaltyDocument.prototype, 'getDocument').callsFake(() => {
				const response = createResponse({
					body: penaltyDocument,
				});
				return Promise.resolve(response);
			});
		});

		afterEach(() => {
			PenaltyDocument.prototype.getDocument.restore();
		});

		it('should return a 200 success with the correct penaltyDocument', async () => {
			const res = await get(event);
			expect(res.statusCode).toBe(200);
			expect(JSON.parse(res.body)).toEqual(penaltyDocument);
		});

	});

});
