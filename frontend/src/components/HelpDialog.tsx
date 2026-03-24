"use client";

import { useEffect } from "react";

interface HelpDialogProps {
  open: boolean;
  onClose: () => void;
}

export function HelpDialog({ open, onClose }: HelpDialogProps) {
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">利用ガイド</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
            aria-label="閉じる"
          >
            ×
          </button>
        </div>

        <div className="space-y-4 text-sm">
          <section>
            <h3 className="font-semibold text-gray-700 mb-1">基本的な使い方</h3>
            <p className="text-gray-600">
              <code className="bg-gray-100 px-1 rounded">owner/repo</code> と
              git ref を入力して Analyze ボタンを押します。
            </p>
          </section>

          <section>
            <h3 className="font-semibold text-gray-700 mb-1">ファイルツリー</h3>
            <p className="text-gray-600">
              ファイルをクリックするとエディタで開きます。解析済みファイルは太字で表示されます。
            </p>
          </section>

          <section>
            <h3 className="font-semibold text-gray-700 mb-2">
              エディタのショートカット
            </h3>
            <table className="w-full text-left">
              <tbody className="divide-y divide-gray-100">
                <tr>
                  <td className="py-1 pr-4">
                    <kbd className="bg-gray-100 border border-gray-300 rounded px-1 font-mono text-xs">
                      h
                    </kbd>
                    <kbd className="bg-gray-100 border border-gray-300 rounded px-1 font-mono text-xs">
                      j
                    </kbd>
                    <kbd className="bg-gray-100 border border-gray-300 rounded px-1 font-mono text-xs ml-1">
                      k
                    </kbd>
                    <kbd className="bg-gray-100 border border-gray-300 rounded px-1 font-mono text-xs ml-1">
                      l
                    </kbd>
                  </td>
                  <td className="py-1 text-gray-600">カーソル移動</td>
                </tr>
                <tr>
                  <td className="py-1 pr-4">
                    <kbd className="bg-gray-100 border border-gray-300 rounded px-1 font-mono text-xs">
                      gg
                    </kbd>
                    {" / "}
                    <kbd className="bg-gray-100 border border-gray-300 rounded px-1 font-mono text-xs">
                      G
                    </kbd>
                  </td>
                  <td className="py-1 text-gray-600">ファイル先頭 / 末尾へ移動</td>
                </tr>
                <tr>
                  <td className="py-1 pr-4">
                    <kbd className="bg-gray-100 border border-gray-300 rounded px-1 font-mono text-xs">
                      Ctrl-e
                    </kbd>
                    {" / "}
                    <kbd className="bg-gray-100 border border-gray-300 rounded px-1 font-mono text-xs">
                      Ctrl-y
                    </kbd>
                  </td>
                  <td className="py-1 text-gray-600">1 行スクロール</td>
                </tr>
                <tr>
                  <td className="py-1 pr-4">
                    <kbd className="bg-gray-100 border border-gray-300 rounded px-1 font-mono text-xs">
                      Ctrl-f
                    </kbd>
                    {" / "}
                    <kbd className="bg-gray-100 border border-gray-300 rounded px-1 font-mono text-xs">
                      Ctrl-b
                    </kbd>
                  </td>
                  <td className="py-1 text-gray-600">1 画面スクロール</td>
                </tr>
                <tr>
                  <td className="py-1 pr-4">
                    <kbd className="bg-gray-100 border border-gray-300 rounded px-1 font-mono text-xs">
                      Ctrl-]
                    </kbd>
                    {" / "}
                    <kbd className="bg-gray-100 border border-gray-300 rounded px-1 font-mono text-xs">
                      Ctrl-t
                    </kbd>
                  </td>
                  <td className="py-1 text-gray-600">定義へ移動 / 戻る</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section>
            <h3 className="font-semibold text-gray-700 mb-2">
              アプリのショートカット
            </h3>
            <table className="w-full text-left">
              <tbody className="divide-y divide-gray-100">
                <tr>
                  <td className="py-1 pr-4">
                    <kbd className="bg-gray-100 border border-gray-300 rounded px-1 font-mono text-xs">
                      gT
                    </kbd>
                    {" / "}
                    <kbd className="bg-gray-100 border border-gray-300 rounded px-1 font-mono text-xs">
                      gt
                    </kbd>
                  </td>
                  <td className="py-1 text-gray-600">左 / 右パネルへ移動</td>
                </tr>
                <tr>
                  <td className="py-1 pr-4">
                    <kbd className="bg-gray-100 border border-gray-300 rounded px-1 font-mono text-xs">
                      j
                    </kbd>
                    {" / "}
                    <kbd className="bg-gray-100 border border-gray-300 rounded px-1 font-mono text-xs">
                      k
                    </kbd>
                  </td>
                  <td className="py-1 text-gray-600">一覧項目の移動</td>
                </tr>
                <tr>
                  <td className="py-1 pr-4">
                    <kbd className="bg-gray-100 border border-gray-300 rounded px-1 font-mono text-xs">
                      h
                    </kbd>
                    {" / "}
                    <kbd className="bg-gray-100 border border-gray-300 rounded px-1 font-mono text-xs">
                      l
                    </kbd>
                  </td>
                  <td className="py-1 text-gray-600">ツリーを閉じる / 開く</td>
                </tr>
                <tr>
                  <td className="py-1 pr-4">
                    <kbd className="bg-gray-100 border border-gray-300 rounded px-1 font-mono text-xs">
                      ?
                    </kbd>
                  </td>
                  <td className="py-1 text-gray-600">このガイドを開く</td>
                </tr>
                <tr>
                  <td className="py-1 pr-4">
                    <kbd className="bg-gray-100 border border-gray-300 rounded px-1 font-mono text-xs">
                      Esc
                    </kbd>
                  </td>
                  <td className="py-1 text-gray-600">ダイアログを閉じる</td>
                </tr>
              </tbody>
            </table>
          </section>
        </div>
      </div>
    </div>
  );
}
