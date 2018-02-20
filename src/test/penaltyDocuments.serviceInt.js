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
					.get('/')
					.set('Context-Type', 'application/json')
					.set('authorization', 'allow')
					.expect(200)
					.expect('Content-Type', 'application/json')
					.end((err, res) => {
						if (err) throw err;
						expect(res.body.penaltyDocuments.length).toEqual(3);
						done();
					});

			});

			it('should block unauthorised requests', (done) => {

				request
					.get('/')
					.set('Context-Type', 'application/json')
					.set('authorization', 'hack')
					.expect(401)
					.end((err, res) => {
						if (err) throw err;
						expect(res.body.message).toEqual('Unauthorized');
						done();
					});

			});

		});

		context('one document', () => {

			it('should return the correct document', (done) => {

				const expectedPenaltyDocument = penaltyDocuments.filter(penaltyDocument => penaltyDocument.referenceNo === '820500000878')[0];

				request
					.get('/820500000878')
					.set('Context-Type', 'application/json')
					.set('authorization', 'allow')
					.expect(200)
					.expect('Content-Type', 'application/json')
					.end((err, res) => {
						if (err) throw err;
						expect(res.body.penaltyDocument).toEqual(expectedPenaltyDocument);
						done();
					});
			});

		});

	});

	context('PUT', () => {

		context('Create new user', () => {

			it('returns the newly created user', (done) => {

				request
					.put('/')
					.set('Context-Type', 'application/json')
					.set('authorization', 'allow')
					.send({
						name: 'Michael',
						role: 'admin',
					})
					.expect(200)
					.expect('Content-Type', 'application/json')
					.end((err, res) => {
						if (err) throw err;
						expect(res.body.user.name).toEqual('Michael');
						expect(res.body.user.role).toEqual('admin');
						return request
							.get('/')
							.set('authorization', 'allow')
							.end((_err, _res) => {
								if (_err) throw _err;
								expect(_res.body.users.length).toEqual(5);
								done();
							});
					});
			});
		});
	});

	context('DELETE', () => {

		it('should return a 200 response and an empty object', (done) => {

			request
				.delete('/2')
				.set('Context-Type', 'application/json')
				.set('authorization', 'allow')
				.expect(200)
				.end((err, res) => {
					if (err) throw err;
					expect(res.body).toEqual({});
					return request
						.get('/')
						.set('authorization', 'allow')
						.end((_err, _res) => {
							if (_err) throw _err;
							expect(_res.body.users.length).toEqual(4);
							done();
						});
				});
		});
	});
});
