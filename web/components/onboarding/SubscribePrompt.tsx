import Link from "next/link";
import { buttonStyles, buttonSizes } from "@/lib/theme";
import { APP_NAME } from "@/lib/pwa-metadata";
import { borderRadius, zIndex } from "@/lib/colors";

interface SubscribePromptProps {
  readonly onClose: () => void;
}

/**
 * Shown when user has zones but no push notification subscriptions
 * Guides them to Settings to enable notifications
 */
export default function SubscribePrompt({ onClose }: SubscribePromptProps) {
  return (
    <>
      {/* Backdrop */}
      <button
        type="button"
        className={`fixed inset-0 ${zIndex.modalBackdrop} bg-black/20 backdrop-blur-sm pointer-events-auto`}
        onClick={onClose}
        aria-label="Затвори"
      />
      <div className={`animate-fade-in fixed inset-0 flex items-center justify-center p-4 ${zIndex.modalContent} pointer-events-none`}>
        <div className="pointer-events-auto w-full max-w-sm bg-warning-light border-2 border-warning-border rounded-lg shadow-xl p-4">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 text-2xl">⚠️</div>
            <div className="flex-1">
              <h3 className="font-semibold text-warning mb-2">
                Няма абонамент за известия
              </h3>
              <p className="text-warning text-sm mb-3">
                Имаш зони на интерес, но не си абониран/а за известия. Това е
                основната задача на {APP_NAME}!
              </p>
              <div className="flex gap-2">
                <Link
                  href="/settings"
                  className={`${buttonSizes.md} font-medium ${buttonStyles.primary} ${borderRadius.md}`}
                >
                  Отиди в настройки
                </Link>
                <button
                  type="button"
                  onClick={onClose}
                  className={`${buttonSizes.md} font-medium ${buttonStyles.warning} ${borderRadius.md}`}
                >
                  По-късно
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
