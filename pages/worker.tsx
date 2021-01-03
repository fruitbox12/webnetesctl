import Title from "antd/lib/typography/Title";
import dynamic from "next/dynamic";
import { useRouter } from "next/router";
import Animate from "rc-animate";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import ParticlesTmpl from "react-particles-js";
import styled from "styled-components";
import SpriteText from "three-spritetext";
import network from "../data/network.json";
import { urldecodeYAMLAll } from "../utils/urltranscode";
import {
  BlurWrapper as BlurWrapperTmpl,
  ContentWrapper as ContentWrapperTmpl,
  Wrapper,
} from "./created";

const particlesConfig: typeof ParticlesTmpl["arguments"] = {
  particles: {
    number: {
      value: 60,
      density: {
        enable: true,
        value_area: 1000,
      },
    },
    line_linked: {
      enable: true,
      opacity: 0.02,
    },
    move: {
      direction: "right",
      speed: 0.2,
    },
    size: {
      value: 1,
    },
    opacity: {
      anim: {
        enable: true,
        speed: 1,
        opacity_min: 0.05,
      },
    },
  },
  interactivity: {
    events: {
      onclick: {
        enable: true,
        mode: "push",
      },
    },
    modes: {
      push: {
        particles_nb: 1,
      },
    },
  },
  retina_detect: true,
};

function Worker() {
  const { t } = useTranslation();
  const router = useRouter();

  const [nodeConfig, setNodeConfig] = useState<string>();

  useEffect(() => {
    const rawNodeConfig = router.query.nodeConfig;

    if (rawNodeConfig) {
      try {
        setNodeConfig(urldecodeYAMLAll(rawNodeConfig as string));
      } catch (e) {
        console.log("could not decode node config", e);
      }
    }
  }, [router.query.nodeConfig]);

  useEffect(() => {
    nodeConfig && console.log(nodeConfig);
  }, [nodeConfig]);

  return (
    <Wrapper>
      <Particles params={particlesConfig} />

      <BlurWrapper>
        <Animate transitionName="fadeandzoom" transitionAppear>
          <ContentWrapper>
            <ForceGraph3D
              graphData={network}
              backgroundColor="rgba(0,0,0,0)"
              showNavInfo={false}
              width={256}
              height={256}
              nodeThreeObject={(node) => {
                const sprite = new SpriteText(node.id?.toString());

                sprite.color = "#ffffff";
                sprite.textHeight = 6;
                sprite.backgroundColor = "rgba(0,0,0,0.5)";
                sprite.padding = 2;

                return sprite;
              }}
            />

            <Title level={1}>{router.query.id}</Title>
          </ContentWrapper>
        </Animate>
      </BlurWrapper>
    </Wrapper>
  );
}

const Particles = styled(ParticlesTmpl)`
  background: transparent;
  width: 100%;
  height: 100%;
  position: absolute;
`;

const ContentWrapper = styled(ContentWrapperTmpl)`
  padding-top: 3rem;
  padding-bottom: 3rem;

  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-direction: row;

  .ant-typography {
    margin-bottom: 0;
  }
`;

const BlurWrapper = styled(BlurWrapperTmpl)`
  margin-top: auto;
`;

const ForceGraph3D = dynamic(
  (async () => (await import("react-force-graph")).ForceGraph3D)(),
  { ssr: false }
);

export default Worker;
