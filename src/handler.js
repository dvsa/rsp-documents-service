// @ts-check
import 'babel-polyfill';

import list from './functions/list';
import listGroups from './functions/listGroups';
import get from './functions/get';
import create from './functions/create';
import createPenaltyGroup from './functions/createPenaltyGroup';
import getPenaltyGroup from './functions/getPenaltyGroup';
import remove from './functions/delete';
import deleteGroup from './functions/deleteGroup';
import updateMulti from './functions/updateMulti';
import sites from './functions/sites';
import streamDocuments from './functions/stream';
import updateWithPayment from './functions/updateWithPayment';
import updateWithReceipt from './functions/updateWithReceipt';
import updateUponPaymentDelete from './functions/updateUponPaymentDelete';
import updateMultipleUponPaymentDelete from './functions/updateMultipleUponPaymentDelete';
import getDocumentByToken from './functions/getDocumentByToken';
import updatePenaltyGroupWithPayment from './functions/updatePenaltyGroupWithPayment';
import updatePenaltyGroupWithReceipt from './functions/updatePenaltyGroupWithReceipt';
import searchByVehicleRegistration from './functions/searchByVehicleRegistration';

const handler = {
	list,
	listGroups,
	get,
	getDocumentByToken,
	create,
	createPenaltyGroup,
	getPenaltyGroup,
	remove,
	deleteGroup,
	updateMulti,
	sites,
	streamDocuments,
	updateMultipleUponPaymentDelete,
	updateWithPayment,
	updateWithReceipt,
	updateUponPaymentDelete,
	updatePenaltyGroupWithPayment,
	updatePenaltyGroupWithReceipt,
	searchByVehicleRegistration,
};

export default handler;
