import { useMutation } from "@tanstack/react-query";
import { Button, Heading, Input, Text } from "@toolbox/components/ui";
import { Con } from "components/layouts/con";
import { useFractal } from "hooks/useParticipatingFractals";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fractalApplet } from "service";

const useGenerateInvite = (fractalId: string) => {
  return useMutation({
    mutationFn: async () => {
      fractalApplet.createFractal;
    },
  });
};

export const Invite = () => {
  const navigate = useNavigate();
  const { fractalID } = useParams();
  const { data } = useFractal(fractalID);

  const [showInviteLink, setShowInviteLink] = useState<boolean>(false);

  const inviteLink = "https://psibase.io/unique-invite-link";

  const onCopy = async () => {
    try {
      const { clipboard } = window.navigator;
      if (!clipboard) {
        throw new Error("unsecure context");
      }
      await clipboard.writeText(inviteLink);
    } catch (e: any) {
      if (e.message === "unsecure context") {
        alert("The clipboard is only accessible within a secure context.");
      }
      console.log(`Error copying: ${e.message}`);
    }
  };

  const createInvite = () => {
    setShowInviteLink(true);
  };

  return (
    <Con title="Invite Members">
      <div className="space-y-2">
        {!showInviteLink ? (
          <>
            <Heading tag="h2" styledAs="h4">
              Invite link
            </Heading>
            <Text>
              If you would like to invite someone to your fractal, generate an
              invitation link and send it to that person. They will be invited
              to create a psibase account if they don't already have one.
            </Text>
            <div className="space-x-2">
              <Button type="secondary" href="..">
                Cancel
              </Button>
              <Button type="primary" onClick={() => createInvite()}>
                Create invite link
              </Button>
            </div>
          </>
        ) : (
          <>
            <Heading tag="h2" styledAs="h4">
              Invite to {data?.displayName}
            </Heading>
            <Text>
              <span className="font-bold">Copy the link below and send it</span>{" "}
              to the person you would like to invite to your fractal.{" "}
              <span className="italic">
                This invitation can only be used once.
              </span>
            </Text>
            <Input
              label="Invitation link"
              readOnly
              rightIcon="copy"
              onClickRightIcon={onCopy}
              value={inviteLink}
            />
            <Button
              type="primary"
              onClick={() => {
                setShowInviteLink(false);
                navigate("..");
              }}
            >
              Done
            </Button>
          </>
        )}
      </div>
    </Con>
  );
};
