"use client"; // Mark as a Client Component

import { useState } from "react";

// Define the expected structure of a diff object
interface DiffItem {
  id: string;
  description: string;
  diff: string;
  url: string;
}

// Define the structure for generated notes
interface GeneratedNotes {
  developerNote: string;
  marketingNote: string;
}

// Define the structure for notes state
interface NotesState {
  [key: string]: {
    loading: boolean;
    error: string | null;
    data: GeneratedNotes | null;
  };
}

// Define the expected structure of the API response
interface ApiResponse {
  diffs: DiffItem[];
  nextPage: number | null;
  currentPage: number;
  perPage: number;
}

export default function Home() {
  const [diffs, setDiffs] = useState<DiffItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [initialFetchDone, setInitialFetchDone] = useState<boolean>(false);
  const [notes, setNotes] = useState<NotesState>({});
  const [processingAll, setProcessingAll] = useState<boolean>(false);

  // Track JSON accumulation for each diff
  const [jsonAccumulator, setJsonAccumulator] = useState<Record<string, string>>({});

  const fetchDiffs = async (page: number) => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/sample-diffs?page=${page}&per_page=10`);
      if (!response.ok) {
        let errorMsg = `HTTP error! status: ${response.status}`;
        try {
          const errorData = await response.json();
          errorMsg = errorData.error || errorData.details || errorMsg;
        } catch {
          console.warn("Failed to parse error response as JSON");
        }
        throw new Error(errorMsg);
      }
      const data: ApiResponse = await response.json();

      setDiffs((prevDiffs) =>
        page === 1 ? data.diffs : [...prevDiffs, ...data.diffs]
      );
      setCurrentPage(data.currentPage);
      setNextPage(data.nextPage);
      if (!initialFetchDone) setInitialFetchDone(true);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "An unknown error occurred"
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleFetchClick = () => {
    setDiffs([]);
    setNotes({});
    fetchDiffs(1);
  };

  const handleLoadMoreClick = () => {
    if (nextPage) {
      fetchDiffs(nextPage);
    }
  };

  // Generate notes for all diffs
  const generateAllNotes = async () => {
    if (processingAll || diffs.length === 0) return;

    setProcessingAll(true);

    try {
      // Process each diff one by one
      for (const diff of diffs) {
        // Skip diffs that are already being processed
        if (!notes[diff.id]?.loading) {
          await generateNotes(diff.id, diff.description, diff.diff);
          // Add a small delay between requests to avoid overwhelming the server
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    } finally {
      setProcessingAll(false);
    }
  };

  const generateNotes = async (diffId: string, description: string, diff: string) => {
    // Reset JSON accumulator for this diff
    setJsonAccumulator(prev => ({...prev, [diffId]: ''}));

    setNotes(prev => ({
      ...prev,
      [diffId]: {
        loading: true,
        error: null,
        data: { developerNote: '', marketingNote: '' }
      }
    }));

    try {
      const response = await fetch('/api/generate-notes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: diffId,
          description,
          diff
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      if (!response.body) {
        throw new Error('No response body');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let partialData = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        partialData += chunk;

        // Process each complete SSE event
        const lines = partialData.split('\n\n');
        partialData = lines.pop() || ''; // Save incomplete line for next chunk

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const eventData = JSON.parse(line.substring(6));

            // Handle delta events
            if (eventData.event === 'response.output_text.delta') {
              try {
                // Get current accumulated JSON
                const currentJson = jsonAccumulator[diffId] || '';
                // Add the new delta
                const updatedJson = currentJson + eventData.data.delta;
                // Update the accumulator
                setJsonAccumulator(prev => ({...prev, [diffId]: updatedJson}));

                // Try to parse the accumulated JSON if it looks complete enough
                if (updatedJson.includes('}') &&
                  updatedJson.includes('"developerNote"') &&
                  updatedJson.includes('"marketingNote"')) {
                  try {
                    // Try to fix any incomplete JSON
                    let fixedJson = updatedJson;
                    if (!fixedJson.endsWith('}')) {
                      fixedJson += '}';
                    }
                    if (!fixedJson.startsWith('{')) {
                      fixedJson = '{' + fixedJson;
                    }

                    const parsedData = JSON.parse(fixedJson);

                    // Update notes with what we have so far
                    setNotes(prev => ({
                      ...prev,
                      [diffId]: {
                        loading: true, // Still loading
                        error: null,
                        data: {
                          developerNote: parsedData.developerNote || '',
                          marketingNote: parsedData.marketingNote || ''
                        }
                      }
                    }));
                  } catch (jsonError) {
                    // JSON not complete yet, that's OK
                    console.debug('JSON not complete yet', jsonError);
                  }
                }
              } catch (e) {
                console.error('Error parsing delta:', e);
              }
            }

            // Handle completion event
            if (eventData.event === 'response.output_text.done') {
              try {
                const completedData = JSON.parse(eventData.data.text);
                setNotes(prev => ({
                  ...prev,
                  [diffId]: {
                    loading: false,
                    error: null,
                    data: completedData
                  }
                }));
              } catch (e) {
                console.error('Error parsing completed data:', e);
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('Error generating notes:', error);
      setNotes(prev => ({
        ...prev,
        [diffId]: {
          loading: false,
          error: error instanceof Error ? error.message : 'Failed to generate notes',
          data: null
        }
      }));
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center p-12 sm:p-24">
      <h1 className="text-4xl font-bold mb-12">Diff Digest ✍️</h1>

      <div className="w-full max-w-4xl">
        {/* Controls Section */}
        <div className="mb-8 flex flex-wrap gap-4">
          <button
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-50"
            onClick={handleFetchClick}
            disabled={isLoading}
          >
            {isLoading && currentPage === 1
              ? "Fetching..."
              : "Fetch Latest Diffs"}
          </button>

          <button
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition-colors disabled:opacity-50"
            onClick={generateAllNotes}
            disabled={processingAll || diffs.length === 0 || Object.values(notes).some(n => n.loading)}
          >
            {processingAll ? "Generating All..." : "Generate All Notes"}
          </button>
        </div>

        {/* Results Section */}
        <div className="border border-gray-300 dark:border-gray-700 rounded-lg p-6 min-h-[300px] bg-gray-50 dark:bg-gray-800">
          <h2 className="text-2xl font-semibold mb-4">Merged Pull Requests</h2>

          {error && (
            <div className="text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/30 p-3 rounded mb-4">
              Error: {error}
            </div>
          )}

          {!initialFetchDone && !isLoading && (
            <p className="text-gray-600 dark:text-gray-400">
              Click the button above to fetch the latest merged pull requests
              from the repository.
            </p>
          )}

          {initialFetchDone && diffs.length === 0 && !isLoading && !error && (
            <p className="text-gray-600 dark:text-gray-400">
              No merged pull requests found or fetched.
            </p>
          )}

          {isLoading && currentPage === 1 && (
            <div className="flex justify-center items-center py-12">
              <div className="w-6 h-6 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin mr-3"></div>
              <p>Loading pull requests...</p>
            </div>
          )}

          {diffs.length > 0 && (
            <div className="space-y-6">
              {diffs.map((item) => (
                <div key={item.id} className="border-b border-gray-200 dark:border-gray-700 pb-4 last:border-b-0">
                  <div className="flex items-start justify-between">
                    <div>
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                      >
                        PR #{item.id}:
                      </a>
                      <span className="ml-2">{item.description}</span>
                    </div>
                    <button
                      onClick={() => generateNotes(item.id, item.description, item.diff)}
                      disabled={notes[item.id]?.loading}
                      className="px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 transition-colors disabled:opacity-50 text-sm"
                    >
                      {notes[item.id]?.loading ? 'Generating...' : 'Generate Notes'}
                    </button>
                  </div>

                  {/* Show this section after clicking the button */}
                  {notes[item.id] && (
                    <div className="mt-4 space-y-4">
                      {/* Show loading indicator during generation */}
                      {notes[item.id].loading && (
                        <div className="flex space-x-2 items-center text-gray-500">
                          <div className="w-4 h-4 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin"></div>
                          <span>Generating release notes...</span>
                        </div>
                      )}

                      {/* Show error if there is one */}
                      {notes[item.id].error && (
                        <div className="text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/30 p-3 rounded">
                          Error: {notes[item.id].error}
                        </div>
                      )}

                      {/* Only show notes when loading is complete */}
                      {!notes[item.id].loading && notes[item.id].data && (
                        <div className="space-y-3">
                          {/* Developer note section */}
                          {notes[item.id].data?.developerNote ? (
                            <div>
                              <h3 className="font-semibold text-gray-700 dark:text-gray-300">Developer Note:</h3>
                              <p className="text-gray-800 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 p-3 rounded">
                                {notes[item.id].data?.developerNote}
                              </p>
                            </div>
                          ) : (
                            <div className="text-amber-600 bg-amber-50 p-3 rounded">
                              No developer note could be generated for this pull request.
                            </div>
                          )}

                          {/* Marketing note section */}
                          {notes[item.id].data?.marketingNote ? (
                            <div>
                              <h3 className="font-semibold text-gray-700 dark:text-gray-300">Marketing Note:</h3>
                              <p className="text-gray-800 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 p-3 rounded">
                                {notes[item.id].data?.marketingNote}
                              </p>
                            </div>
                          ) : (
                            <div className="text-amber-600 bg-amber-50 p-3 rounded">
                              No marketing note could be generated for this pull request.
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {isLoading && currentPage > 1 && (
            <p className="text-gray-600 dark:text-gray-400 mt-4">
              Loading more...
            </p>
          )}

          {nextPage && !isLoading && (
            <div className="mt-6">
              <button
                className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors disabled:opacity-50"
                onClick={handleLoadMoreClick}
                disabled={isLoading}
              >
                Load More (Page {nextPage})
              </button>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
