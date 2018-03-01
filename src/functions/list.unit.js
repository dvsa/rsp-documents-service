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

		beforeEach(() => {
			event = {
				httpMethod: 'GET',
				pathParameters: null,
			};
			sinon.stub(PenaltyDocument.prototype, 'getDocuments').callsFake((offset, callback) => {
				const response = createResponse({
					body: penaltyDocuments,
				});
				callback(null, response);
			});
		});

		it('should return a 200 success', (done) => {

			list(event, null, (err, res) => {
				expect(err).toBe(null);
				expect(res.statusCode).toBe(200);
				expect(res.body).toEqual(JSON.stringify(penaltyDocuments));
				done();
			});

		});

	});

});
