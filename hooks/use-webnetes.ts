import { feature } from "@ideditor/country-coder";
import * as Nominatim from "nominatim-browser";
import getPublicIp from "public-ip";
import { useCallback, useEffect, useState } from "react";
import { unstable_batchedUpdates } from "react-dom";
import { useTranslation } from "react-i18next";
import clusterNodesData from "../data/network-cluster.json";
import clusterConnectionsData from "../data/network-connections.json";
import nodeConfigData, { nodeId as nodeIdData } from "../data/node-config";
import clusterResourcesData from "../data/resources-cluster.json";
import statsComputeData from "../data/stats-compute.json";
import statsNetworkingData from "../data/stats-networking.json";

const NODE_GID = 0;

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

export const useWebnetes = () => {
  // Hooks
  const { t } = useTranslation();

  // State
  const [clusterGraph, setClusterGraph] = useState<IGraph>();
  const [localGraph, setLocalGraph] = useState<IGraph>();
  const [networkGraph, setNetworkGraph] = useState<IGraph>();
  const [resourceGraph, setResourceGraph] = useState<IGraph>();

  const [computeStats, setComputeStats] = useState<INodeScore[]>();
  const [networkingStats, setNetworkingStats] = useState<INodeScore[]>();

  const [clusterConnections, setClusterConnections] = useState<IConnections>();
  const [clusterNodes, setClusterNodes] = useState<IClusterNode[]>();
  const [clusterResources, setClusterResources] = useState<
    IClusterResource[]
  >();

  const [nodeConfig, setNodeConfig] = useState<string>();
  const [nodeId, setNodeId] = useState<string>();

  const [nodePublicIPv6, setNodePublicIPv6] = useState<string>();

  const [nodeCoordinates, setNodeCoordinates] = useState<number[]>([0, 0]);
  const [nodeCoordinatesLoading, setNodeCoordinatesLoading] = useState(false);
  const [nodeAddress, setNodeAddress] = useState<string>();
  const [nodeFlag, setNodeFlag] = useState<string>();

  const [log, setLog] = useState<string[]>([]);

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
      navigator.geolocation.getCurrentPosition(
        (position) => {
          unstable_batchedUpdates(() => {
            setNodeCoordinates([
              position.coords.latitude,
              position.coords.longitude,
            ]);
            setNodeCoordinatesLoading(false);
            appendToLog(t("resolvedLocation"));
          });
        },
        (e) => {
          console.error(
            "could not get user location, falling back to [0, 0]",
            e
          );

          setNodeCoordinates([0, 0]);
          setNodeCoordinatesLoading(false);
          appendToLog(t("deniedLocationAccess"));
        }
      );
  }, []);

  // Effects
  useEffect(() => {
    // Set initial state
    unstable_batchedUpdates(() => {
      setComputeStats(statsComputeData);
      setNetworkingStats(statsNetworkingData);

      setClusterConnections(clusterConnectionsData);
      setClusterNodes(clusterNodesData);
      setClusterResources(clusterResourcesData);

      setNodeConfig(nodeConfigData);
      setNodeId(nodeIdData);
    });
  }, []);

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

      setNetworkGraph({
        nodes,
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
    if (nodeId && networkGraph) {
      // Get resource graph for nodeId
      const resourceGraph = getResourceGraphForNode(nodeId);

      // Merge resource graph and network graph
      const mergedGraph = mergeResourceAndNetworkGraphs(
        [resourceGraph],
        networkGraph
      );

      setLocalGraph(mergedGraph);
    }
  }, [nodeId, networkGraph]);

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
  }, [clusterNodes, networkGraph]);

  useEffect(() => {
    // Get the public IPv6 address
    getPublicIp
      .v6()
      .then((ip) => setNodePublicIPv6(ip))
      .catch((e) => console.log("could not get public IPv6", e));
  }, []);

  useEffect(() => {
    // Map coordinates to an address
    Nominatim.reverseGeocode({
      lat: nodeCoordinates[0].toString(),
      lon: nodeCoordinates[1].toString(),
      addressdetails: true,
    }).then((res: any) => {
      if (res.address?.country_code) {
        const feat = feature(res.address?.country_code as string);

        if (feat) {
          unstable_batchedUpdates(() => {
            setNodeAddress(res.display_name);
            setNodeFlag(feat.properties.emojiFlag!);
          });
        }
      }
    });
  }, [nodeCoordinates]);

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
  };
};
