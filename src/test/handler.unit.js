import expect from 'expect';
import * as handler from '../handler';
import list from '../functions/list';
import listGroups from '../functions/listGroups';
import get from '../functions/get';
import create from '../functions/create';
import createPenaltyGroup from '../functions/createPenaltyGroup';
import getPenaltyGroup from '../functions/getPenaltyGroup';
import remove from '../functions/delete';
import deleteGroup from '../functions/deleteGroup';
import updateMulti from '../functions/updateMulti';
import sites from '../functions/sites';
import streamDocuments from '../functions/stream';
import updateWithPayment from '../functions/updateWithPayment';
import updateWithPaymentStartTime from '../functions/updateWithPaymentStartTime';
import updateUponPaymentDelete from '../functions/updateUponPaymentDelete';
import updateMultipleUponPaymentDelete from '../functions/updateMultipleUponPaymentDelete';
import getDocumentByToken from '../functions/getDocumentByToken';
import updatePenaltyGroupWithPayment from '../functions/updatePenaltyGroupWithPayment';
import updatePenaltyGroupWithPaymentStartTime from '../functions/updatePenaltyGroupWithPaymentStartTime';
import searchByVehicleRegistration from '../functions/searchByVehicleRegistration';

describe('Handler', () => {
	const handlers = [
		{ name: 'list', actualHandler: list, expected: handler.list },
		{ name: 'listGroups', actualHandler: listGroups, expected: handler.listGroups },
		{ name: 'get', actualHandler: get, expected: handler.get },
		{ name: 'getDocumentByToken', actualHandler: getDocumentByToken, expected: handler.getDocumentByToken },
		{ name: 'create', actualHandler: create, expected: handler.create },
		{ name: 'createPenaltyGroup', actualHandler: createPenaltyGroup, expected: handler.createPenaltyGroup },
		{ name: 'getPenaltyGroup', actualHandler: getPenaltyGroup, expected: handler.getPenaltyGroup },
		{ name: 'remove', actualHandler: remove, expected: handler.remove },
		{ name: 'deleteGroup', actualHandler: deleteGroup, expected: handler.deleteGroup },
		{ name: 'updateMulti', actualHandler: updateMulti, expected: handler.updateMulti },
		{ name: 'sites', actualHandler: sites, expected: handler.sites },
		{ name: 'streamDocuments', actualHandler: streamDocuments, expected: handler.streamDocuments },
		{ name: 'updateMultipleUponPaymentDelete', actualHandler: updateMultipleUponPaymentDelete, expected: handler.updateMultipleUponPaymentDelete },
		{ name: 'updateWithPayment', actualHandler: updateWithPayment, expected: handler.updateWithPayment },
		{ name: 'updateWithPaymentStartTime', actualHandler: updateWithPaymentStartTime, expected: handler.updateWithPaymentStartTime },
		{ name: 'updateUponPaymentDelete', actualHandler: updateUponPaymentDelete, expected: handler.updateUponPaymentDelete },
		{ name: 'updatePenaltyGroupWithPayment', actualHandler: updatePenaltyGroupWithPayment, expected: handler.updatePenaltyGroupWithPayment },
		{ name: 'updatePenaltyGroupWithPaymentStartTime', actualHandler: updatePenaltyGroupWithPaymentStartTime, expected: handler.updatePenaltyGroupWithPaymentStartTime },
		{ name: 'searchByVehicleRegistration', actualHandler: searchByVehicleRegistration, expected: handler.searchByVehicleRegistration },
	];

	handlers.forEach(({ name, actualHandler, expected }) => {
		it(`It returns an instance of the ${name} handler`, () => {
			expect(actualHandler).toBe(expected);
		});
	});
});
