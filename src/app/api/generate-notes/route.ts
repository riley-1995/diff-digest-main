import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

export const runtime = 'edge';

export async function POST(request: Request) {
    try {
        const { id, description, diff } = await request.json();

        console.log(`Request for PR #${id}`, {
            description: description,
            diffPreview: diff.length > 100 ? diff.substring(0, 100) + '...' : diff
        });

        if (id == null || description == null || diff == null) {
            return new Response(JSON.stringify({ error: 'Missing required fields' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

        const schema = z.object({
            developerNote: z.string(),
            marketingNote: z.string(),
        });

        // Create stream from OpenAI
        const events = await openai.responses.stream({
            model: "gpt-4.1-mini",
            input: [
                {
                    role: "system",
                    content: 
                        `You will receive a git pull request description and diff.
                        Generate two types of release notes:
                        
                        1. Developer note (developerNote): A concise technical note focusing on _what_ changed and _why_.
                        (e.g., "Refactored useFetchDiffs hook to use \`useSWR\` for improved caching and reduced re-renders.").
                        
                        2. Marketing note (marketingNote): A user-centric note in simpler language highlighting the _benefit_ of the change.
                        (e.g., "Loading pull requests is now faster and smoother thanks to improved data fetching!").
                        
                        The notes should be BREIF and to the point (strictly one or two sentences at most).

                        Avoid generating information that is not present in the description or diff.
                        If you cannot generate a meaningful and accurate note, return an empty string.
                        Do not include any other text or explanations.`
                },
                {
                    role: "user",
                    content: `Description: ${description}\nDiff: ${diff}`
                },
            ],
            text: {
                format: zodTextFormat(schema, "notes"),
            },
        })

        // Create a ReadableStream that emits SSE data
        const stream = new ReadableStream({
            async start(controller) {
            try {
                for await (const event of events) {
                // Sending all events to the client
                const data = JSON.stringify({
                    event: event.type,
                    data: event,
                });
                controller.enqueue(`data: ${data}\n\n`);
                }
                // End of stream
                controller.close();
            } catch (error) {
                console.error("Error in streaming loop:", error);
                controller.error(error);
            }
            },
        });
  
      // Return the ReadableStream as SSE
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });

        // // Create stream from OpenAI
        // const stream = await openai.responses.stream({
        //     model: "gpt-4.1-mini",
        //     input: [
        //         {
        //             role: "system",
        //             content: 
        //                 `You will receive a git pull request description and diff.
        //                 Generate two types of release notes:
                        
        //                 1. Developer note (developerNote): A concise technical note focusing on _what_ changed and _why_.
        //                 (e.g., "Refactored useFetchDiffs hook to use \`useSWR\` for improved caching and reduced re-renders.").
                        
        //                 2. Marketing note (marketingNote): A user-centric note in simpler language highlighting the _benefit_ of the change.
        //                 (e.g., "Loading pull requests is now faster and smoother thanks to improved data fetching!").
                        
        //                 The notes should be short and to the point, ideally one or two sentences each.

        //                 Avoid generating information that is not present in the description or diff.
        //                 If you cannot generate a meaningful and accurate note, return an empty string.
        //                 Do not include any other text or explanations.`
        //         },
        //         {
        //             role: "user",
        //             content: `Description: ${description}\nDiff: ${diff}`
        //         },
        //     ],
        //     text: {
        //         format: zodTextFormat(schema, "notes"),
        //     },
        // })
        // .on("response.refusal.delta", (event) => {
        //     console.log(event.delta);
        //   })
        //   .on("response.output_text.delta", (event) => {
        //     console.log(event.delta);
        //   })
        //   .on("response.output_text.done", () => {
        //     console.log("\n");
        //   })
        //   .on("error", (event) => {
        //     console.log(event.message);
        //   });
        
        // const result = await stream.finalResponse();
        
        // // console.log(result.output_text);

        // return new Response(JSON.stringify(result), {
        //     status: 200,
        //     headers: { 'Content-Type': 'application/json' }
        // });

    } catch (error) {
        console.error("Error in route handler:", error);
        let errorMessage = 'Unknown error generating notes';
        let errorStatus = 500;
        
        if (error instanceof Error) {
            errorMessage = error.message;
        }
        
        if (typeof error === 'object' && error !== null && 'status' in error) {
            errorStatus = (error.status as number);
        }
        
        return new Response(JSON.stringify({ error: 'Failed to generate notes', details: errorMessage }), {
            status: errorStatus,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
