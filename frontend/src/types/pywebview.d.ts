interface PyWebViewApi {
  get_config(): Promise<{ api_url: string; has_api_key: boolean }>;
}

interface Window {
  pywebview?: {
    api: PyWebViewApi;
  };
}
