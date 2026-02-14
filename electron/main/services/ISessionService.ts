/**
 * SSH/Telnet サービスの共通インターフェース。
 * 両プロトコルが同じ API を公開することで、
 * メインプロセス側のセッション管理コードから型安全に利用できます。
 */
export interface ISessionService {
    /** リモートホストへ接続 */
    connect(config: any): void | Promise<void>;

    /** データ（ユーザー入力）をリモートへ送信 */
    write(data: string): void;

    /** ターミナルサイズ変更を通知 */
    resize(cols: number, rows: number): void;

    /** 接続を切断 */
    disconnect(): void;

    /** 文字エンコーディングを変更 */
    setEncoding(encoding: string): void;

    /** データ受信時のコールバック登録 (ログ保存用) */
    onData(callback: (data: string) => void): void;
}
