"use client";

import { useState } from "react";
import { buttonStyles, buttonSizes } from "@/lib/theme";
import { APP_NAME } from "@/lib/pwa-metadata";
import { borderRadius } from "@/lib/colors";
import type { ApiClient } from "@/lib/types";
import { toast } from "sonner";

interface ApiAccessSectionProps {
  readonly apiClient: ApiClient | null;
  readonly onGenerate: (websiteUrl: string) => Promise<boolean>;
  readonly onRevoke: () => Promise<boolean>;
  readonly isLoading: boolean;
}

const apiDocsUrl = (() => {
  const raw = process.env.NEXT_PUBLIC_API_DOCS_URL;
  if (!raw) return null;
  try {
    const { protocol } = new URL(raw);
    return protocol === "http:" || protocol === "https:" ? raw : null;
  } catch {
    return null;
  }
})();

export default function ApiAccessSection({
  apiClient,
  onGenerate,
  onRevoke,
  isLoading,
}: ApiAccessSectionProps) {
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [urlError, setUrlError] = useState("");
  const [showRevokeConfirm, setShowRevokeConfirm] = useState(false);
  const [revokeText, setRevokeText] = useState("");
  const [copied, setCopied] = useState(false);

  const validateUrl = (url: string): boolean => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  };

  const handleGenerate = async () => {
    const trimmedUrl = websiteUrl.trim();
    if (!validateUrl(trimmedUrl)) {
      setUrlError("Въведи валиден http/https URL адрес");
      return;
    }
    setUrlError("");
    const success = await onGenerate(trimmedUrl);
    if (success) {
      setWebsiteUrl("");
    }
  };

  const handleRevoke = async () => {
    const success = await onRevoke();
    if (success) {
      setShowRevokeConfirm(false);
      setRevokeText("");
    }
  };

  const handleCopy = async () => {
    if (!apiClient?.apiKey) return;
    if (!navigator.clipboard?.writeText) {
      toast.error("Копирането не се поддържа в този браузър. Копирай ключа ръчно.");
      return;
    }
    try {
      await navigator.clipboard.writeText(apiClient.apiKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      toast.error("Неуспешно копиране. Копирай ключа ръчно.");
    }
  };

  return (
    <section className="bg-white rounded-lg shadow mb-6 p-6">
      <h2 className="text-xl font-semibold text-foreground mb-2">
        Публичен API достъп
      </h2>
      <p className="text-neutral text-sm mb-4">
        API ключът позволява достъп от приложения до публичните данни на{" "}
        <span translate="no">{APP_NAME}</span>
        {apiDocsUrl ? (
          <>
            {". Тук е "}
            <a
              href={apiDocsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-link underline"
            >
              документацията
            </a>
            .
          </>
        ) : "."}
      </p>

      {apiClient ? (
        <div className="space-y-4">
          <div className="border border-neutral-border rounded-lg p-4 bg-neutral-light">
            <p className="text-xs text-neutral mb-1 font-medium">API ключ</p>
            <div className="flex items-center gap-2">
              <code className="font-mono text-sm break-all flex-1 text-foreground">
                {apiClient.apiKey}
              </code>
              <button
                type="button"
                onClick={handleCopy}
                className={`${buttonSizes.sm} ${buttonStyles.secondary} ${borderRadius.sm} shrink-0`}
              >
                {copied ? "Копирано" : "Копирай"}
              </button>
            </div>
          </div>

          <p className="text-sm text-neutral">
            <span className="font-medium">Уебсайт:</span>{" "}
            <a
              href={apiClient.websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-link underline break-all"
            >
              {apiClient.websiteUrl}
            </a>
          </p>

          {showRevokeConfirm ? (
            <div className="border border-error-border rounded-lg p-4 bg-error-light">
              <p className="text-error font-semibold mb-2">
                Наистина ли искаш да отмениш API ключа?
              </p>
              <p className="text-error text-sm mb-4">
                Всички приложения, използващи този ключ, ще загубят достъп
                незабавно. Напиши <strong>ОТМЕНИ</strong> за потвърждение:
              </p>
              <input
                type="text"
                value={revokeText}
                onChange={(e) => setRevokeText(e.target.value)}
                placeholder="ОТМЕНИ"
                className={`w-full px-3 py-2 border border-error-border ${borderRadius.md} mb-4 focus:outline-none focus:ring-2 focus:ring-error`}
              />
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleRevoke}
                  disabled={isLoading || revokeText !== "ОТМЕНИ"}
                  className={`${buttonSizes.md} ${buttonStyles.destructive} ${borderRadius.md}`}
                >
                  {isLoading ? "Отменяне..." : "Потвърди отмяната"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowRevokeConfirm(false);
                    setRevokeText("");
                  }}
                  disabled={isLoading}
                  className={`${buttonSizes.md} ${buttonStyles.secondary} ${borderRadius.md}`}
                >
                  Назад
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowRevokeConfirm(true)}
              className={`${buttonSizes.md} ${buttonStyles.destructive} ${borderRadius.md}`}
            >
              Отмени API ключа
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-neutral">
            Нямаш активен API ключ. Предостави URL на проекта, в който планираш
            да ползваш данните (уебсайт, GitHub repo, приложение и др.).
          </p>
          <div>
            <input
              type="url"
              value={websiteUrl}
              onChange={(e) => {
                setWebsiteUrl(e.target.value);
                setUrlError("");
              }}
              placeholder="https://example.com/my-project"
              className={`w-full px-3 py-2 border ${urlError ? "border-error-border" : "border-neutral-border"} ${borderRadius.md} focus:outline-none focus:ring-2 focus:ring-primary mb-1`}
            />
            {urlError && <p className="text-error text-xs mt-1">{urlError}</p>}
          </div>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={isLoading || !websiteUrl.trim()}
            className={`${buttonSizes.md} ${buttonStyles.primary} ${borderRadius.md}`}
          >
            {isLoading ? "Генериране..." : "Генерирай API ключ"}
          </button>
        </div>
      )}
    </section>
  );
}
