import supertest from 'supertest';
import expect from 'expect';

const url = 'http://localhost:3000/penaltyGroup';
const request = supertest(url);
const groupId = '15317465650001337';

describe('penaltyGroups', () => {

	context('GET', () => {
		context('all penalty groups', () => {
			it('should return all penalty groups', (done) => {
				request
					.get(`/${groupId}`)
					.set('Content-Type', 'application/json')
					.set('Authorization', 'allow')
					.expect(200)
					.expect('Content-Type', 'application/json')
					.end((err, res) => {
						if (err) throw err;
						expect(res.body.ID).toEqual(groupId);
						expect(res.body.Timestamp).toBe(1521311200);
						expect(res.body.VehicleRegistration).toBe('11 ABC');
						expect(res.body.Location).toBe('Trowell Services');
						expect(res.body.Payments).toHaveLength(1);
						expect(res.body.Payments[0].PaymentCategory).toBe('FPN');
						expect(res.body.Payments[0].PaymentStatus).toBe('UNPAID');
						expect(res.body.Payments[0].TotalAmount).toBe(130);
						expect(res.body.Payments[0].Penalties).toHaveLength(2);
						expect(res.body.Payments[0].Penalties[0].ID).toBe('820500000877_FPN');
						expect(res.body.Payments[0].Penalties[0].Value).toBeDefined();
						expect(res.body.Payments[0].Penalties[1].ID).toBe('820500000878_FPN');
						expect(res.body.Payments[0].Penalties[1].Value).toBeDefined();
						expect(res.body.PenaltyDocumentIds).toBeUndefined();
						done();
					});
			});
		});
	});

	context('POST', () => {
		context('a new penalty group', () => {
			it('should return created penalty group with generated ID', (done) => {
				const fakePenaltyGroupPayload = {
					Timestamp: 1532945465.234729,
					SiteCode: -72,
					Location: 'Trowell Services',
					VehicleRegistration: '11 ABC',
					Penalties: [
						{
							ID: 'p1',
							Hash: 'somehash',
							Enabled: true,
							Value: {
								penaltyType: 'FPN',
								inPenaltyGroup: true,
								penaltyAmount: 150,
								paymentToken: '1234abcdef',
								referenceNo: '12345678',
								vehicleDetails: {
									regNo: 'AA123',
								},
								officerName: 'Joe Bloggs',
								officerID: 'XYZ',
								dateTime: 1532000305,
								siteCode: 3,
							},
						},
						{
							ID: 'p2',
							Hash: 'somehash',
							Enabled: true,
							Value: {
								penaltyType: 'IM',
								inPenaltyGroup: true,
								penaltyAmount: 80,
								paymentToken: '1234abcdef',
								referenceNo: '87654321',
								vehicleDetails: {
									regNo: 'BB123',
								},
								officerName: 'Joe Bloggs',
								officerID: 'XYZ',
								dateTime: 1532000305,
								siteCode: 3,
							},
						},
					],
				};
				request
					.post('/')
					.set('Content-Type', 'application/json')
					.set('Authorization', 'allow')
					.send(fakePenaltyGroupPayload)
					.expect(201)
					.expect('Content-Type', 'application/json')
					.end((err, res) => {
						if (err) throw err;
						expect(res.body.ID).toBe('46xu68x7wps');
						expect(res.body.Timestamp).toBe(1532945465.234729);
						expect(res.body.Location).toBe('Trowell Services');
						expect(res.body.VehicleRegistration).toBe('11 ABC');
						expect(res.body.TotalAmount).toBe(230);
						expect(res.body.PaymentStatus).toBe('UNPAID');
						expect(res.body.Penalties).toHaveLength(2);
						expect(res.body.Penalties[0].inPenaltyGroup).toBe(true);
						expect(res.body.Penalties[1].inPenaltyGroup).toBe(true);
						expect(res.body.PenaltyGroupIds).toBeUndefined();
						done();
					});
			});
		});
	});

});

