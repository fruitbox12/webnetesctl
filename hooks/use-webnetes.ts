import {
  API_VERSION,
  EBenchmarkKind,
  EResourceKind,
  Node,
} from "@pojntfx/webnetes";
import { useCallback, useEffect, useRef, useState } from "react";
import { unstable_batchedUpdates } from "react-dom";
import { useTranslation } from "react-i18next";
import clusterConnectionsData from "../data/network-connections.json";
import nodeConfigData, { nodeId as nodeIdData } from "../data/node-config";
import { getCoordinates } from "../utils/get-coordinates";
import { getCPUScore } from "../utils/get-cpu-score";
import { getIP } from "../utils/get-ip";
import { getLocation } from "../utils/get-location";
import { getNetScore } from "../utils/get-net-score";

export const NODE_GID = 0;

export interface IConnections {
  management: number[][][];
  application: number[][][];
}

export interface IGraph {
  nodes: { id: string; group: number }[];
  links: {
    source: string;
    target: string;
    value: number;
  }[];
}

export interface IClusterNode {
  privateIP: string;
  publicIP: string;
  location: string;
  latitude: number;
  longitude: number;
  size: number;
}

export interface IClusterResource {
  kind: string;
  name: string;
  label: string;
  node: string;
  src: string;
}

export interface INodeScore {
  ip: string;
  score: number;
}

export const useWebnetes = ({
  onResourceRejection,
  onCPUBenchmarking,
  onNetworkBenchmarking,
}: {
  onResourceRejection: (diagnostics: any) => Promise<void>;
  onCPUBenchmarking: () => () => any;
  onNetworkBenchmarking: () => () => any;
}) => {
  // Hooks
  const { t } = useTranslation();

  // State
  const [clusterGraph, setClusterGraph] = useState<IGraph>();
  const [localGraph, setLocalGraph] = useState<IGraph>();
  const [networkGraph, setNetworkGraph] = useState<IGraph>();
  const [
    networkGraphForLocalGraph,
    setNetworkGraphForLocalGraph,
  ] = useState<IGraph>();
  const [resourceGraph, setResourceGraph] = useState<IGraph>();

  const [computeStats, setComputeStats] = useState<Map<string, number>>(
    new Map()
  );
  const [networkingStats, setNetworkingStats] = useState<Map<string, number>>(
    new Map()
  );

  const [clusterConnections, setClusterConnections] = useState<IConnections>();
  const [clusterNodes, setClusterNodes] = useState<IClusterNode[]>([]);
  const clusterNodesRef = useRef<IClusterNode[]>();
  const [clusterResources, setClusterResources] = useState<IClusterResource[]>(
    []
  );

  const [nodeConfig, setNodeConfig] = useState<string>();
  const [nodeId, setNodeId] = useState<string>();
  const nodeIdRef = useRef<string>();

  const [nodePublicIPv6, setNodePublicIPv6] = useState<string>();

  const [nodeCoordinates, setNodeCoordinates] = useState<number[]>([0, 0]);
  const [nodeCoordinatesLoading, setNodeCoordinatesLoading] = useState(false);
  const [nodeAddress, setNodeAddress] = useState<string>();
  const [nodeFlag, setNodeFlag] = useState<string>();

  const [log, setLog] = useState<string[]>([]);

  const [node, setNode] = useState<Node>();
  const [nodeOpened, setNodeOpened] = useState(false);

  const [refreshNodeInformation, setRefreshNodeInformation] = useState(false);

  // Callbacks
  const getResourceGraphForNode = useCallback(
    (nodeIdFilter: string) => {
      // Parse serialized resources
      const resources = clusterResources!
        .filter((resource) => resource.node === nodeIdFilter)
        .map((resource) => JSON.parse(JSON.parse(resource.src)));

      // Group by kinds
      const kinds = new Map<string, { gid: number; items: string[] }>();
      kinds.set("Node", { gid: NODE_GID, items: [nodeIdFilter] });
      resources.forEach((resource) => {
        !kinds.has(resource.kind) &&
          kinds.set(resource.kind, { gid: kinds.size, items: [] });

        kinds.get(resource.kind)!.items.push(resource.metadata.label); // We set abolve
      });

      // Collect to nodes
      const nodes: any[] = [];
      kinds.forEach((res, kind) =>
        res.items.forEach((label) =>
          nodes.push({ group: res.gid, id: `${kind}/${label}` })
        )
      );

      // Connect everything but the root node itself to the root node
      const links: any[] = [];
      nodes.forEach(
        (node) =>
          node.group !== NODE_GID && // Don't connect nodes to each other
          nodes
            .filter((candidate) => candidate.group === NODE_GID)
            .forEach((nodeResource) =>
              links.push({
                source: nodeResource.id,
                target: node.id,
                value: 1,
              })
            )
      );

      return { nodes, links };
    },
    [clusterResources]
  );

  const mergeResourceAndNetworkGraphs = useCallback(
    (resourceGraphs: IGraph[], networkGraph: IGraph) => {
      // Merge nodes
      let nodes: any[] = [];
      resourceGraphs.forEach((resourceGraph) => {
        nodes = [...nodes, ...resourceGraph.nodes];
      });

      // Remove duplicates
      nodes = [...nodes, ...networkGraph.nodes].reduce(
        (all, curr) =>
          all.find((candidate: IGraph["nodes"][0]) => candidate.id === curr.id)
            ? all
            : [...all, curr],
        []
      );

      // Merge links
      let links: any[] = [];
      resourceGraphs.forEach((resourceGraph) => {
        links = [...links, ...resourceGraph.links];
      });

      return {
        nodes,
        links: [...links, ...networkGraph.links].map((link) => ({
          source: link.source,
          target: link.target,
          value: link.value,
        })),
      };
    },
    []
  );

  const appendToLog = useCallback(
    // Add to the end of the visual log
    (msg) => {
      setLog((oldLog) => [
        ...oldLog,
        `${new Date().toLocaleTimeString()}: ${msg}`,
      ]);
    },
    [log]
  );

  const refreshNodeLocation = useCallback(() => {
    // Get a user's coordinates and set them
    setNodeCoordinatesLoading(true);
    appendToLog(t("requestedLocation"));

    typeof window !== "undefined" &&
      getCoordinates()
        .then(({ latitude, longitude }) =>
          unstable_batchedUpdates(() => {
            setNodeCoordinates([latitude, longitude]);
            setNodeCoordinatesLoading(false);
            appendToLog(t("resolvedLocation"));

            // In the future, a message would only have to be sent to a designated manager node.
            clusterNodesRef.current?.forEach(async (clusterNode) => {
              await node?.createResources(
                [
                  {
                    apiVersion: API_VERSION,
                    kind: EResourceKind.COORDINATES,
                    metadata: {
                      name: "Node Coordinates",
                      label: "node_coordinates",
                    },
                    spec: {
                      describes: nodeIdRef.current,
                      latitude,
                      longitude,
                    },
                  },
                ],
                clusterNode.privateIP
              );
            });
          })
        )
        .catch((e) => {
          console.error(
            "could not get user location, falling back to [0, 0]",
            e
          );

          setNodeCoordinates([0, 0]);
          setNodeCoordinatesLoading(false);
          appendToLog(t("deniedLocationAccess"));
        });
  }, [node]);

  // Effects
  useEffect(() => {
    // Set initial state
    unstable_batchedUpdates(() => {
      setClusterConnections(clusterConnectionsData);

      setNodeConfig(nodeConfigData);
      setNodeId(nodeIdData);
    });
  }, []);

  useEffect(() => {
    // Run a short CPU benchmark and send it
    if (node && nodeOpened) {
      (async () => {
        try {
          const done = onCPUBenchmarking();

          const cpuScore = await getCPUScore();

          done();

          // In the future, a message would only have to be sent to a designated manager node.
          clusterNodesRef.current?.forEach(async (clusterNode) => {
            await node?.createResources(
              [
                {
                  apiVersion: API_VERSION,
                  kind: EResourceKind.BENCHMARK_SCORE,
                  metadata: {
                    name: "CPU Benchmark",
                    label: "cpu_benchmark",
                  },
                  spec: {
                    describes: nodeIdRef.current,
                    kind: EBenchmarkKind.CPU,
                    score: cpuScore,
                  },
                },
              ],
              clusterNode.privateIP
            );
          });
        } catch (e) {
          console.error("could not get CPU benchmark", e);
        }
      })();
    }
  }, [node, nodeOpened, refreshNodeInformation]);

  useEffect(() => {
    // Run a short network benchmark and send it
    if (node && nodeOpened) {
      (async () => {
        try {
          const done = onNetworkBenchmarking();

          const netScore = await getNetScore(100000);

          done();

          // In the future, a message would only have to be sent to a designated manager node.
          clusterNodesRef.current?.forEach(async (clusterNode) => {
            await node?.createResources(
              [
                {
                  apiVersion: API_VERSION,
                  kind: EResourceKind.BENCHMARK_SCORE,
                  metadata: {
                    name: "Network Benchmark",
                    label: "net_benchmark",
                  },
                  spec: {
                    describes: nodeIdRef.current,
                    kind: EBenchmarkKind.NET,
                    score: netScore,
                  },
                },
              ],
              clusterNode.privateIP
            );
          });
        } catch (e) {
          console.error("could not get network benchmark", e);
        }
      })();
    }
  }, [node, nodeOpened, refreshNodeInformation]);

  useEffect(() => {
    // Get the public IPv6 address
    if (node && nodeOpened) {
      (async () => {
        try {
          const ip = await getIP();

          setNodePublicIPv6(ip);

          // In the future, a message would only have to be sent to a designated manager node.
          clusterNodesRef.current?.forEach(async (clusterNode) => {
            await node?.createResources(
              [
                {
                  apiVersion: API_VERSION,
                  kind: EResourceKind.PUBLIC_IP,
                  metadata: {
                    name: "Public IP",
                    label: "public_ip",
                  },
                  spec: {
                    describes: nodeIdRef.current,
                    publicIP: ip,
                  },
                },
              ],
              clusterNode.privateIP
            );
          });
        } catch (e) {
          console.log("could not get public IPv6", e);
        }
      })();
    }
  }, [node, nodeOpened, refreshNodeInformation]);

  useEffect(() => {
    // Create the resource graph
    if (clusterResources && nodeId) {
      setResourceGraph(getResourceGraphForNode(nodeId));
    }
  }, [clusterResources, nodeId]);

  useEffect(() => {
    // Create the network graph
    if (clusterNodes) {
      // Transform into graph-internal node format
      const nodes = clusterNodes.map((node) => ({
        id: `Node/${node.privateIP}`,
        group: NODE_GID,
      }));

      // Connect every node to every other node except for itself
      const links: any[] = [];
      nodes.forEach((node) =>
        nodes
          .filter((candidate) => candidate.id !== node.id)
          .forEach((peer) =>
            links.push({
              source: node.id,
              target: peer.id,
              value: 1,
            })
          )
      );

      // Three.js modifies the graphs below. We have to store & copy them seperately like so.
      setNetworkGraph({
        nodes: nodes.map((node) => ({
          id: node.id,
          group: node.group,
        })),
        links: links.map((link) => ({
          source: link.source,
          target: link.target,
          value: link.value,
        })),
      });

      setNetworkGraphForLocalGraph({
        nodes: nodes.map((node) => ({
          id: node.id,
          group: node.group,
        })),
        links: links.map((link) => ({
          source: link.source,
          target: link.target,
          value: link.value,
        })),
      });
    }
  }, [clusterNodes]);

  useEffect(() => {
    // Create node-local/"peer-resources" graph
    if (nodeId && networkGraphForLocalGraph) {
      // Get resource graph for nodeId
      const resourceGraph = getResourceGraphForNode(nodeId);

      // Merge resource graph and network graph
      const mergedGraph = mergeResourceAndNetworkGraphs(
        [resourceGraph],
        networkGraphForLocalGraph
      );

      setLocalGraph(mergedGraph);
    }
  }, [nodeId, networkGraphForLocalGraph]);

  useEffect(() => {
    // Create cluster-wide resource graph
    if (clusterNodes && networkGraph) {
      // Get resource graph for each node
      const resourceGraphs = clusterNodes.map((node) =>
        getResourceGraphForNode(node.privateIP)
      );

      // Merge resource graphs and network graph
      const mergedGraph = mergeResourceAndNetworkGraphs(
        resourceGraphs,
        networkGraph
      );

      setClusterGraph(mergedGraph);
    }
  }, [clusterNodes, clusterResources, networkGraph]);

  useEffect(() => {
    // Map coordinates to an address
    if (nodeCoordinates) {
      (async () => {
        const { address, flag } = await getLocation({
          latitude: nodeCoordinates[0].toString(),
          longitude: nodeCoordinates[1].toString(),
        });

        unstable_batchedUpdates(() => {
          setNodeAddress(address);
          setNodeFlag(flag);
        });
      })();
    }
  }, [nodeCoordinates]);

  useEffect(() => {
    setNode(
      new Node(
        async (nodeId, resource) => {
          appendToLog(
            `Created resource: ${JSON.stringify(resource)}@${nodeId}`
          );

          if (resource.kind === EResourceKind.COORDINATES) {
            (async () => {
              const { address } = await getLocation({
                latitude: resource.spec.latitude,
                longitude: resource.spec.longitude,
              });

              setClusterNodes((oldClusterNodes) => {
                const newClusterNodes = oldClusterNodes.map((clusterNode) =>
                  clusterNode.privateIP === resource.spec.describes
                    ? {
                        ...clusterNode,
                        location: address
                          ? address
                              .split(", ")
                              .filter((_: string, i: number) => i <= 3)
                              .join(", ")
                          : t("notSet"),
                        latitude: resource.spec.latitude,
                        longitude: resource.spec.longitude,
                      }
                    : clusterNode
                );

                clusterNodesRef.current = newClusterNodes;

                return newClusterNodes;
              });
            })();
          } else if (resource.kind === EResourceKind.PUBLIC_IP) {
            setClusterNodes((oldClusterNodes) => {
              const newClusterNodes = oldClusterNodes.map((clusterNode) =>
                clusterNode.privateIP === resource.spec.describes
                  ? {
                      ...clusterNode,
                      publicIP: resource.spec.publicIP,
                    }
                  : clusterNode
              );

              clusterNodesRef.current = newClusterNodes;

              return newClusterNodes;
            });
          } else if (resource.kind === EResourceKind.BENCHMARK_SCORE) {
            switch (resource.spec.kind) {
              case EBenchmarkKind.CPU: {
                setComputeStats((oldComputeStats) => {
                  oldComputeStats.set(
                    resource.spec.describes,
                    resource.spec.score
                  );

                  return oldComputeStats;
                });

                break;
              }

              case EBenchmarkKind.NET: {
                setNetworkingStats((oldNetworkingStats) => {
                  oldNetworkingStats.set(
                    resource.spec.describes,
                    resource.spec.score
                  );

                  return oldNetworkingStats;
                });

                break;
              }

              default: {
                console.error(
                  "could not process unknown benchmark type",
                  resource.spec.kind
                );
              }
            }
          } else if (nodeIdRef.current) {
            setClusterResources((oldClusterResources) => [
              ...oldClusterResources,
              {
                kind: resource.kind,
                name: resource.metadata.name || resource.metadata.label,
                label: resource.metadata.label,
                node: nodeId, // We check above
                src: JSON.stringify(JSON.stringify(resource)),
              },
            ]);
          }
        },
        async (nodeId, resource) => {
          appendToLog(
            `Deleted resource: ${JSON.stringify(resource)}@${nodeId}`
          );

          setClusterResources((oldClusterResources) =>
            oldClusterResources.filter(
              (candidate) =>
                !(candidate.node === nodeId,
                candidate.kind === resource.kind &&
                  candidate.label === resource.metadata.label)
            )
          );

          if (resource.kind === EResourceKind.WORKLOAD) {
            window.location.reload();
          }
        },
        async (frame) => {
          appendToLog(`Rejected resource: ${JSON.stringify(frame)}`);

          await onResourceRejection(frame);
        },
        async (id) => {
          appendToLog(`Management node acknowledged: ${id}`);

          setNodeId(id);
          nodeIdRef.current = id;
          setClusterNodes((oldClusterNodes) => {
            const newClusterNodes = [
              ...oldClusterNodes,
              {
                privateIP: id,
                publicIP: t("loading"),
                location: t("loading"),
                latitude: 0,
                longitude: 0,
                size: 10000000,
              },
            ];

            clusterNodesRef.current = newClusterNodes;

            setRefreshNodeInformation((handleIP) => !handleIP);

            return newClusterNodes;
          });
        },
        async (id) => {
          appendToLog(`Management node joined: ${id}`);

          setClusterNodes((oldClusterNodes) => {
            const newClusterNodes = [
              ...oldClusterNodes,
              {
                privateIP: id,
                publicIP: t("loading"),
                location: t("loading"),
                latitude: 0,
                longitude: 0,
                size: 10000000,
              },
            ];

            clusterNodesRef.current = newClusterNodes;

            setRefreshNodeInformation((handleIP) => !handleIP);

            return newClusterNodes;
          });
        },
        async (id) => {
          appendToLog(`Management node left: ${id}`);

          setClusterNodes((oldClusterNodes) => {
            const newClusterNodes = oldClusterNodes.filter(
              (candidate) => candidate.privateIP !== id
            );

            clusterNodesRef.current = newClusterNodes;

            return newClusterNodes;
          });
        },
        async (metadata, spec, id) => {
          appendToLog(
            `Resource node acknowledged: ${JSON.stringify(
              metadata
            )}, ${JSON.stringify(spec)}, ${id}`
          );

          setClusterNodes((oldClusterNodes) => {
            const newClusterNodes = [
              ...oldClusterNodes,
              {
                privateIP: id,
                publicIP: t("loading"),
                location: t("loading"),
                latitude: 0,
                longitude: 0,
                size: 10000000,
              },
            ];

            clusterNodesRef.current = newClusterNodes;

            return newClusterNodes;
          });
        },
        async (metadata, spec, id) => {
          appendToLog(
            `Resource node joined: ${JSON.stringify(
              metadata
            )}, ${JSON.stringify(spec)}, ${id}`
          );

          setClusterNodes((oldClusterNodes) => {
            const newClusterNodes = [
              ...oldClusterNodes,
              {
                privateIP: id,
                publicIP: t("loading"),
                location: t("loading"),
                latitude: 0,
                longitude: 0,
                size: 10000000,
              },
            ];

            clusterNodesRef.current = newClusterNodes;

            return newClusterNodes;
          });
        },
        async (metadata, spec, id) => {
          appendToLog(
            `Resource node left: ${JSON.stringify(metadata)}, ${JSON.stringify(
              spec
            )}, ${id}`
          );

          setClusterNodes((oldClusterNodes) => {
            const newClusterNodes = oldClusterNodes.filter(
              (candidate) => candidate.privateIP !== id
            );

            clusterNodesRef.current = newClusterNodes;

            return newClusterNodes;
          });
        },
        async (onStdin: (key: string) => Promise<void>, id) => {
          console.log("Creating terminal (STDOUT only)", id);
        },
        async (id, msg) => {
          console.log("Writing to terminal (STDOUT only)", id, msg);
        },
        async (id) => {
          console.log("Deleting terminal", id);
        },
        (id) => {
          console.error("STDIN is not supported on this node");

          return null;
        }
      )
    );
  }, []);

  return {
    graphs: {
      cluster: clusterGraph,
      network: networkGraph,
      resources: resourceGraph,
      local: localGraph,
    },
    stats: {
      compute: computeStats,
      networking: networkingStats,
    },
    cluster: {
      connections: clusterConnections,
      nodes: clusterNodes,
      resources: clusterResources,
    },
    local: {
      nodeConfig,
      setNodeConfig,
      nodeId,
      nodePublicIPv6,

      location: {
        refreshLocation: refreshNodeLocation,
        loading: nodeCoordinatesLoading,
        latitude: nodeCoordinates[0],
        longitude: nodeCoordinates[1],
        address: nodeAddress,
        flag: nodeFlag,
      },
    },
    log,
    node: {
      open: async (config: string) => {
        setNodeConfig(config);

        await node?.open(config);

        setNodeOpened(true);
      },
      close: async () => await node?.close(),
      opened: nodeOpened,
      createResources: async (resources: string, nodeId: string) =>
        await node?.createResources(resources, nodeId),
      seedFile: async (
        label: string,
        name: string,
        repository: string,
        fileInstance: Uint8Array
      ) => await node?.seedFile(label, name, repository, fileInstance),
      deleteResources: async (resources: string, nodeId: string) =>
        await node?.deleteResources(resources, nodeId),
    },
  };
};
