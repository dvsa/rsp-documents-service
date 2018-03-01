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
					id: '1',
				},
			};
			penaltyDocument = penaltyDocuments.filter(item => item.ID === '820500000878');
			sinon.stub(PenaltyDocument.prototype, 'getDocument').callsFake((id, callback) => {
				const response = createResponse({
					body: penaltyDocument,
				});
				callback(null, response);
			});
		});

		it('should return a 200 success with the correct penaltyDocument', (done) => {

			get(event, null, (err, res) => {
				expect(err).toBe(null);
				expect(res.statusCode).toBe(200);
				expect(JSON.parse(res.body)).toEqual(penaltyDocument);
				done();
			});

		});

	});

});
