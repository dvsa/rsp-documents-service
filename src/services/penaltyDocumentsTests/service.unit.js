import PenaltyDocumentsService from '../penaltyDocuments';


function mockPenaltyDocumentsService(doc) {
	return new PenaltyDocumentsService(doc, 'penaltyDocuments', '', '', '', '', 'tokenServiceArn', 3, '');
}

export default mockPenaltyDocumentsService;
