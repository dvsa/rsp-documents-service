import supertest from 'supertest';


const url = 'http://localhost:3001/documents';
const request = supertest(url);

describe('payment deletion reflection', () => {
	context('updating upon payment deletion', () => {
		context('update single doc', () => {
			it('updates a single document', (done) => {
				request.put('/updateUponPaymentDelete')
					.set('Context-Type', 'application/json')
					.set('authorization', 'allow')
					.send({
						id: '820500000812_FPN',
						paymentStatus: 'UNPAID',
					})
					.expect(200)
					.end((err) => {
						if (err) throw err;
						done();
					});
			});
		});
		context('update multi docs', () => {
			it('updates multiple documents', (done) => {
				request.put('/updateMultipleUponPaymentDelete')
					.set('Context-Type', 'application/json')
					.set('authorization', 'allow')
					.send({
						penaltyDocumentIds: ['820500000878_FPN', '820500000877_FPN'],
					})
					.expect(200)
					.end((err) => {
						if (err) throw err;
						done();
					});
			});
		});
	});
});
