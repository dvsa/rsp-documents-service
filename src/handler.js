import auth from './functions/auth';
import list from './functions/list';
import get from './functions/get';
import create from './functions/create';
import createPenaltyGroup from './functions/createPenaltyGroup';
import getPenaltyGroup from './functions/getPenaltyGroup';
import remove from './functions/delete';
import updateMulti from './functions/updateMulti';
import sites from './functions/sites';
import stream from './functions/stream';
import updateWithPayment from './functions/updateWithPayment';
import updateUponPaymentDelete from './functions/updateUponPaymentDelete';
import getDocumentByToken from './functions/getDocumentByToken';

const handler = {
	auth,
	list,
	get,
	getDocumentByToken,
	create,
	createPenaltyGroup,
	getPenaltyGroup,
	remove,
	updateMulti,
	sites,
	stream,
	updateWithPayment,
	updateUponPaymentDelete,
};

export default handler;
