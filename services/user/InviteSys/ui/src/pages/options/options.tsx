import { psiboardApplet } from "service";
import { Button, Heading, Icon, Text } from "components";
import { useParam } from "store";
import { userUsers, useUser } from "store/hooks/useUser";
import { useInviteToken } from "store/queries/usePrivateKey";
import { useInitilize } from "store/hooks/useInitialize";
import { useGenerateLink } from "store/hooks/useGenerateLink";

export const Options = () => {
  useInitilize(psiboardApplet);

  const token = useParam("token");
  const appletName = useParam("applet");

  const { data: currentUser } = useUser();
  const { data: users, error: usersError } = userUsers();

  const { isValid: isInviteValid, error } = useInviteToken(token);
  const {
    data: inviteLink,
    mutate: generateLink,
    isLoading: isInviting,
    error: inviteError,
  } = useGenerateLink();

  const isSignedIn = true;

  console.log({ users, usersError });

  return (
    <>
      <section>
        <header>
          <Heading tag="h1" styledAs="h2">
            {isSignedIn ? "Choose an account" : "Sign in"}
          </Heading>
          <Text size="base" className="mb-2">
            To continue to {appletName} new one
          </Text>
        </header>
        {isSignedIn ? (
          <div className="border-y border-gray-300">
            {users?.map((account) => (
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
            ))}
          </div>
        ) : null}
      </section>
      <section className="bg-gray-50 p-3">
        <Text size="base">
          {isSignedIn ? "Or s" : "S"}ign in with an existing psibase account.
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
      {isInviteValid && (
        <section className="bg-gray-50 p-3">
          <Text size="base">Or create a new psibase account and sign in.</Text>
          {/* TODO: Get styles for "go" button type for other states (hover, pressed, disabled, etc.) */}
          <Button
            size="xl"
            type="primary"
            href={`/sign-up?token=${token}`}
            title="Create account"
          >
            Create account and sign in
          </Button>
        </section>
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
