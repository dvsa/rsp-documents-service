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
						expect(res.body.Penalties).toHaveLength(2);
						expect(res.body.Penalties[0].ID).toBe('820500000877_FP');
						expect(res.body.Penalties[0].Value).toBeDefined();
						expect(res.body.Penalties[1].ID).toBe('820500000878_FP');
						expect(res.body.Penalties[1].Value).toBeDefined();
						done();
					});
			});
		});
	});

	context('POST', () => {
		context('a new penalty group', () => {
			it('should return created penalty group with generated ID', (done) => {
				const fakePenaltyGroupPayload = {
					UserID: '1337',
					Timestamp: '12345678',
					Penalties: [
						{
							ID: 'p1',
						},
						{
							ID: 'p2',
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
						expect(res.body.ID).toBe('123456781337');
						expect(res.body.Penalties).toHaveLength(2);
						done();
					});
			});
		});
	});

});

