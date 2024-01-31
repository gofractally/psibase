import { connectToChild } from 'penpal';

type Options = {
  src?: string;
};

const getSupervisorHref = (subDomain = 'supervisor-sys'): string => {
  const currentUrl = window.location.href;
  const url = new URL(currentUrl);
  const hostnameParts = url.hostname.split('.');

  hostnameParts.shift();
  hostnameParts.unshift(subDomain);
  url.hostname = hostnameParts.join('.');

  return url.origin;
};

interface FunctionCallParam<T = any> {
  service: string;
  method: string;
  params?: T;
}

export interface SupervisorReturn {
  functionCall: (param: FunctionCallParam) => Promise<any>;
}

export const connect = (options?: Options): Promise<SupervisorReturn> => {
  const iframe = document.createElement('iframe');
  iframe.src = options?.src || getSupervisorHref();
  iframe.style.display = 'none';

  if (
    document.readyState === 'complete' ||
    document.readyState === 'interactive'
  ) {
    document.body.appendChild(iframe);
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      document.body.appendChild(iframe);
    });
  }

  const connection = connectToChild({
    iframe,
    methods: {
      add: (a: number, b: number) => a + b,
    },
  });

  return connection.promise as unknown as Promise<SupervisorReturn>;
};