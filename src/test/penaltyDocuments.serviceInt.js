import supertest from 'supertest';
import expect from 'expect';

import penaltyDocuments from '../../mock-data/fake-penalty-notice.json';


const url = 'http://localhost:3000/documents';
const request = supertest(url);

describe('penaltyDocuments', () => {
	context('GET', () => {
		context('all documents', () => {
			it('should return all documents', (done) => {
				request
					.get('/?Offset=1521311200')
					.set('Context-Type', 'application/json')
					.expect(200)
					.expect('Content-Type', 'application/json; charset=utf-8')
					.end((err, res) => {
						if (err) throw err;
						expect(res.body.Items).toHaveLength(7);
						done();
					});
			});
		});

		context('one document', () => {
			it('should return the correct document', (done) => {
				const expectedPenaltyDocument = penaltyDocuments.filter(penaltyDocument => penaltyDocument.referenceNo === '820500000878')[0];
				request
					.get('/820500000878_FPN')
					.set('Context-Type', 'application/json')
					.expect(200)
					.expect('Content-Type', 'application/json; charset=utf-8')
					.end((err, res) => {
						if (err) throw err;
						expect(res.body.penaltyDocument).toEqual(expectedPenaltyDocument);
						done();
					});
			});
		});
	});
});
