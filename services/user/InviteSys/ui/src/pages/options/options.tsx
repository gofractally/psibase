import { psiboardApplet } from "service";
import { Button, Heading, Icon, Text } from "components";
import { useParam } from "store";
import { useUsers, useUser } from "store/hooks/useUser";
import { useInviteToken } from "store/queries/usePrivateKey";
import { useInitilize } from "store/hooks/useInitialize";
import { useGenerateLink } from "store/hooks/useGenerateLink";
import { Link } from "react-router-dom";

export const Options = () => {
  useInitilize(psiboardApplet);

  const token = useParam("token");
  const ref = useParam("ref");
  const appletName = useParam("applet");

  const { data: currentUser } = useUser();
  const { data: users, error: usersError } = useUsers();

  const {
    isValid: isInviteValid,
    error: tokenError,
    isLoading,
  } = useInviteToken(token);
  const {
    data: inviteLink,
    mutate: generateLink,
    isLoading: isInviting,
    error: inviteError,
  } = useGenerateLink();

  const isSignedIn = (users || []).length > 0;

  if (tokenError)
    return (
      <Text size="base" className="mb-2 text-red-500">
        {tokenError}
      </Text>
    );

  if (isLoading) {
    <Text size="base" className="mb-2">
      Loading..
    </Text>;
  }

  return (
    <>
      <section>
        <header>
          <Heading tag="h1" styledAs="h2">
            {isSignedIn ? "Choose an account" : "Sign in"}
          </Heading>
          <Text size="base" className="mb-2">
            To continue to {appletName}
          </Text>
        </header>
        {isSignedIn && isInviteValid ? (
          <div className="border-y border-gray-300 overflow-y-auto h-64">
            {users?.map((account) => (
              <Link
                to={`/select-account?account=${account}&token=${token}&ref=${ref}`}
              >
                <div
                  key={account}
                  className="flex cursor-pointer items-center justify-between px-3 py-5 hover:bg-gray-100"
                >
                  <Text span className="font-medium">
                    {account}
                  </Text>
                  <Icon
                    type="chevron-right"
                    size="xs"
                    className="text-gray-500"
                  />
                </div>
              </Link>
            ))}
          </div>
        ) : null}
      </section>
      {isInviteValid && (
        <>
          <section className="bg-gray-50 p-3">
            <Text size="base">
              {isSignedIn ? "Or s" : "S"}ign in with an existing psibase
              account.
            </Text>
            {/* TODO: Get styles for "go" button type for other states (hover, pressed, disabled, etc.) */}
            <Button
              size="xl"
              type={isSignedIn ? "primary" : "cta_fractally"}
              href="/sign-in"
              title="Sign in"
            >
              Sign in
            </Button>
          </section>
          <section className="bg-gray-50 p-3">
            <Text size="base">
              Or create a new psibase account and sign in.
            </Text>
            {/* TODO: Get styles for "go" button type for other states (hover, pressed, disabled, etc.) */}
            <Button
              size="xl"
              type="primary"
              href={`/sign-up?token=${token}&ref=${ref}`}
              title="Create account"
            >
              Create account
            </Button>
          </section>
        </>
      )}
      {currentUser && (
        <section className="bg-gray-50 p-3">
          <Text size="base">Invite a friend!</Text>
          <Button
            size="xl"
            type="primary"
            onClick={() => generateLink()}
            title="Create account"
          >
            Generate invite link
          </Button>
          {inviteError && <Text size="xs">{inviteError}</Text>}
          <Text size="xs">
            {isInviting ? (
              "Loading..."
            ) : (
              <a href={inviteLink} target="_blank">
                {inviteLink}
              </a>
            )}
          </Text>
        </section>
      )}
    </>
  );
};
