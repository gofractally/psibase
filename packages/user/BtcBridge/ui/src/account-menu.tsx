// The account menu every app shows at the right of its top bar (packages/shared-ui), mounted in
// this page's header. It is the only place on the page to sign in, switch account or log out.
import {QueryClientProvider} from '@tanstack/react-query';
import {createRoot} from 'react-dom/client';

import {AccountMenu} from '@shared/components/account-menu';
import {ThemeProvider} from '@shared/components/theme-provider';
import {queryClient} from '@shared/lib/query-client';
import QueryKey from '@shared/lib/query-keys';
import {Toaster} from '@shared/shadcn/ui/sonner';

export function mountAccountMenu(host:HTMLElement){
 createRoot(host).render(
  <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
   <QueryClientProvider client={queryClient}>
    <AccountMenu/>
    <Toaster/>
   </QueryClientProvider>
  </ThemeProvider>,
 );
}
/// Ask the wallet again who is signed in, e.g. when the page is shown again.
export const refreshAccountMenu=()=>queryClient.invalidateQueries({queryKey:QueryKey.currentUser()});
