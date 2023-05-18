import { APIGatewayProxyResult } from 'aws-lambda';

export async function handle(event: { body: string }): Promise<APIGatewayProxyResult> {
	return {
		statusCode: 200,
		body: event.body
	};
}
