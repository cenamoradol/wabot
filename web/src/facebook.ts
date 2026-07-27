declare global {
  interface Window {
    FB?: FacebookSdk;
    fbAsyncInit?: () => void;
  }
}

type FacebookSdk = {
  init: (params: { appId: string; cookie?: boolean; xfbml?: boolean; version?: string }) => void;
  login: (
    response: (response: FacebookLoginResponse) => void,
    params: { config_id: string; response_type?: string; redirect_uri?: string; scope?: string },
  ) => void;
};

export type FacebookLoginResponse = {
  authResponse?: { code?: string; accessToken?: string };
  status?: string;
};

let sdkPromise: Promise<FacebookSdk> | null = null;

function loadSdk(): Promise<FacebookSdk> {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<FacebookSdk>((resolve, reject) => {
    const tryInit = () => {
      if (window.FB) {
        resolve(window.FB);
        return;
      }
      setTimeout(tryInit, 100);
    };
    if (document.querySelector('script[src*="connect.facebook.net/sdk.js"]')) {
      tryInit();
    } else {
      reject(new Error("Facebook SDK script tag not present in index.html"));
      return;
    }
    setTimeout(() => reject(new Error("Facebook SDK load timeout")), 10_000);
  });
  return sdkPromise;
}

export async function initFacebook(appId: string, version = "v23.0"): Promise<FacebookSdk> {
  const FB = await loadSdk();
  FB.init({ appId, cookie: true, xfbml: false, version });
  return FB;
}

export async function launchEmbeddedSignup(input: {
  appId: string;
  configId: string;
  redirectUri: string;
}): Promise<{ code: string }> {
  const FB = await initFacebook(input.appId);
  return new Promise<{ code: string }>((resolve, reject) => {
    FB.login(
      (response) => {
        if (response.status !== "connected" || !response.authResponse?.code) {
          reject(new Error(response.status === "not_authorized" ? "El usuario canceló o no autorizó la app" : `Facebook login status: ${response.status ?? "unknown"}`));
          return;
        }
        resolve({ code: response.authResponse.code });
      },
      { config_id: input.configId, response_type: "code", redirect_uri: input.redirectUri, scope: "whatsapp_business_management,whatsapp_business_messaging" },
    );
  });
}
