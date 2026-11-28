import { LoadingStatus } from "@/components/LoadingStatus";
import { MessageCardSkeleton } from "@/components/MessageCard";
import { getButtonClasses } from "@/lib/theme";

const loadError = "Грешка при зареждане на съобщенията. Опитай отново.";

interface MessageListStatusProps {
  readonly isLoading: boolean;
  readonly hasError: boolean;
}

export function MessageListStatus({ isLoading, hasError }: MessageListStatusProps) {
  return (
    <>
      <LoadingStatus
        isLoading={isLoading}
        loadingMessage="Съобщенията се зареждат."
        finishedMessage={hasError ? loadError : "Съобщенията са заредени."}
      />
      {hasError && (
        <div className="mb-6 rounded-md border border-error-border bg-error-light p-4 text-error">
          {loadError}
        </div>
      )}
    </>
  );
}

interface MessageListPaginationProps {
  readonly hasNextPage: boolean;
  readonly isFetchingNextPage: boolean;
  readonly onLoadMore: () => Promise<unknown>;
}

export function MessageListPagination({
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
}: MessageListPaginationProps) {
  return (
    <>
      {hasNextPage && (
        <div className="mt-8 flex justify-center">
          <button
            type="button"
            onClick={() => {
              void onLoadMore();
            }}
            className={getButtonClasses("ghost", "lg", "sm")}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? "Зареждане..." : "Покажи още"}
          </button>
        </div>
      )}
      {isFetchingNextPage && (
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 3 }, (_, index) => (
            <MessageCardSkeleton key={`loading-${index}`} />
          ))}
        </div>
      )}
    </>
  );
}
