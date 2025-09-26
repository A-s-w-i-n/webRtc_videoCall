import { useState, useEffect, useRef, useCallback } from "react";
import {
  Video,
  VideoOff,
  Mic,
  MicOff,
  PhoneOff,
  Users,
  Copy,
  Check,
} from "lucide-react";

const VideoCallApp = () => {
  const [ws, setWs] = useState<any>(null);
  const [currentView, setCurrentView] = useState<any>("home");
  const [roomName, setRoomName] = useState<any>("");
  const [userName, setUserName] = useState<any>("");
  const [isInRoom, setIsInRoom] = useState<any>(false);
  const [connectedUsers, setConnectedUsers] = useState<any>([]);
  const [isVideoEnabled, setIsVideoEnabled] = useState<any>(true);
  const [isAudioEnabled, setIsAudioEnabled] = useState<any>(true);
  const [roomCopied, setRoomCopied] = useState<any>(false);
  const [error, setError] = useState<any>("");
  const [connectionStatus, setConnectionStatus] = useState<any>("disconnected");
  const [isCreator, setIsCreator] = useState<any>(false);

  console.log(isInRoom,ws)
  // WebRTC refs
  const localVideoRef = useRef<any>(null);
  const remoteVideoRef = useRef<any>(null);
  const localStreamRef = useRef<any>(null);
  const peerConnectionRef = useRef<any>(null);
  const pendingCandidatesRef = useRef<any>([]);
  const wsRef = useRef<any>(null);
  const shouldCreateOfferRef = useRef<any>(false);

  const safePlay = (videoEl: any) => {
    if (!videoEl) return;
    const playPromise = videoEl.play();
    if (playPromise && typeof playPromise.then === "function") {
      playPromise.catch(() => {
        // ignore autoplay policy rejections; UI interactions will start playback
      });
    }
  };

  // WebRTC configuration
  const iceServers = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
    ],
  };

  // WebSocket connection
  const connectWebSocket = useCallback(() => {
    try {
      const websocket = new WebSocket("ws://web-rtc-video-call-4585.vercel.app");
      wsRef.current = websocket;

      websocket.onopen = () => {
        console.log("WebSocket connected");
        setConnectionStatus("connected");
        setWs(websocket);
        setError("");
      };

      websocket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleWebSocketMessage(data);
      };

      websocket.onclose = () => {
        console.log("WebSocket disconnected");
        setConnectionStatus("disconnected");
        setWs(null);
        // Attempt to reconnect after 3 seconds
        setTimeout(connectWebSocket, 3000);
      };

      websocket.onerror = (error) => {
        console.error("WebSocket error:", error);
        setError("Connection failed. Retrying...");
        setConnectionStatus("error");
      };
    } catch (error) {
      console.error("WebSocket connection error:", error);
      setError("Failed to connect to server");
    }
  }, []);

  const sendMessage = useCallback((type: any, data: any) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, ...data }));
    }
  }, []);

  const handleWebSocketMessage = useCallback(
    (data: any) => {
      const { type, ...payload } = data;

      switch (type) {
        case "room-created":
          setIsInRoom(true);
          setCurrentView("room");
          setIsCreator(true);
          // initializeMedia moved to useEffect
          break;

        case "room-joined":
          setIsInRoom(true);
          setCurrentView("room");
          setIsCreator(false);
          setConnectedUsers(payload.users || []);
          // initializeMedia moved to useEffect
          break;

        case "user-joined":
          setConnectedUsers(payload.users || []);
          // When a user joins, the creator should initiate the offer
          if (isCreator && payload.users && payload.users.length === 2) {
            setTimeout(() => {
              if (localStreamRef.current) {
                createOffer();
              } else {
                shouldCreateOfferRef.current = true;
              }
            }, 1000); // Small delay to ensure both sides are ready
          }
          break;

        case "user-left":
          setConnectedUsers(payload.users || []);
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = null;
          }
          if (peerConnectionRef.current) {
            peerConnectionRef.current.close();
            peerConnectionRef.current = null;
          }
          pendingCandidatesRef.current = [];
          break;

        case "offer":
          console.log("Received offer, creating answer");
          createAnswer(payload.offer);
          break;

        case "answer":
          console.log("Received answer");
          if (peerConnectionRef.current) {
            peerConnectionRef.current
              .setRemoteDescription(payload.answer)
              .then(() => {
                console.log("Remote description set successfully");
                // Add any pending ICE candidates
                for (const candidate of pendingCandidatesRef.current) {
                  peerConnectionRef.current.addIceCandidate(candidate);
                }
                pendingCandidatesRef.current = [];
              })
              .catch((err: any) => {
                console.error("Error setting remote description:", err);
              });
          }
          break;

        case "ice-candidate":
          if (
            peerConnectionRef.current &&
            peerConnectionRef.current.remoteDescription
          ) {
            peerConnectionRef.current
              .addIceCandidate(payload.candidate)
              .catch((err: any) => {
                console.error("Error adding ICE candidate:", err);
              });
          } else {
            pendingCandidatesRef.current.push(payload.candidate);
          }
          break;

        case "user-video-toggle":
          console.log(
            `User ${payload.userId} ${
              payload.enabled ? "enabled" : "disabled"
            } video`
          );
          break;

        case "user-audio-toggle":
          console.log(
            `User ${payload.userId} ${
              payload.enabled ? "enabled" : "disabled"
            } audio`
          );
          break;

        case "room-error":
          setError(payload.message);
          break;

        default:
          console.log("Unknown message type:", type);
      }
    },
    [isCreator]
  );

  useEffect(() => {
    connectWebSocket();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (localStreamRef.current) {
        localStreamRef.current
          .getTracks()
          .forEach((track: any) => track.stop());
      }
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }
    };
  }, [connectWebSocket]);

  // Initialize media after room view is rendered
  useEffect(() => {
    if (currentView === "room" && !localStreamRef.current) {
      initializeMedia();
    }
  }, [currentView]);

  const initializeMedia = async () => {
    try {
      console.log("Initializing media...");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });

      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        localVideoRef.current.muted = true;
        safePlay(localVideoRef.current);
      }

      // If we were waiting to create an offer, do it now
      if (shouldCreateOfferRef.current) {
        shouldCreateOfferRef.current = false;
        setTimeout(createOffer, 500); // Small delay to ensure stream is ready
      }
    } catch (err) {
      console.error("Error accessing media devices:", err);
      setError("Could not access camera/microphone");
    }
  };

  const addLocalTracks = (pc: any) => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track: any) => {
        console.log("Adding track to peer connection:", track.kind);
        pc.addTrack(track, localStreamRef.current);
      });
    } else {
      console.warn("No local stream available to add tracks");
    }
  };

  const createPeerConnection = () => {
    console.log("Creating peer connection...");
    const pc = new RTCPeerConnection(iceServers);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log("Sending ICE candidate");
        sendMessage("ice-candidate", {
          candidate: event.candidate,
          roomName,
        });
      }
    };

    pc.ontrack = (event) => {
      console.log("Received remote stream", event.streams);
      if (remoteVideoRef.current && event.streams[0]) {
        remoteVideoRef.current.srcObject = event.streams[0];
        remoteVideoRef.current.muted = false;
        safePlay(remoteVideoRef.current);
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log("ICE connection state:", pc.iceConnectionState);
    };

    pc.onconnectionstatechange = () => {
      console.log("Connection state:", pc.connectionState);
    };

    return pc;
  };

  const createOffer = async () => {
    try {
      console.log("Creating offer...");

      // Ensure local media is ready
      if (!localStreamRef.current) {
        await initializeMedia();
        if (!localStreamRef.current) {
          console.error("No local stream available");
          return;
        }
      }

      // Close existing peer connection if any
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }

      peerConnectionRef.current = createPeerConnection();
      addLocalTracks(peerConnectionRef.current);
      const offer = await peerConnectionRef.current.createOffer();

      await peerConnectionRef.current.setLocalDescription(offer);
      console.log("Sending offer");

      sendMessage("offer", {
        offer,
        roomName,
      });
    } catch (error) {
      console.error("Error creating offer:", error);
      setError("Failed to create call offer");
    }
  };

  const createAnswer = async (offer: any) => {
    try {
      console.log("Creating answer...");

      // Ensure local media is ready before answering
      if (!localStreamRef.current) {
        await initializeMedia();
        if (!localStreamRef.current) {
          console.error("No local stream available");
          return;
        }
      }

      // Close existing peer connection if any
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }

      peerConnectionRef.current = createPeerConnection();
      await peerConnectionRef.current.setRemoteDescription(offer);

      // Process any buffered ICE candidates
      for (const candidate of pendingCandidatesRef.current) {
        try {
          await peerConnectionRef.current.addIceCandidate(candidate);
        } catch (e: any) {
          console.warn("Failed adding buffered ICE candidate", e);
        }
      }
      pendingCandidatesRef.current = [];

      // Add local tracks AFTER setting remote description
      addLocalTracks(peerConnectionRef.current);

      const answer = await peerConnectionRef.current.createAnswer();
      await peerConnectionRef.current.setLocalDescription(answer);
      console.log("Sending answer");

      sendMessage("answer", {
        answer,
        roomName,
      });
    } catch (error) {
      console.error("Error creating answer:", error);
      setError("Failed to answer call");
    }
  };

  const createRoom = () => {
    if (!roomName.trim() || !userName.trim()) {
      setError("Please enter both room name and your name");
      return;
    }

    if (connectionStatus !== "connected") {
      setError("Not connected to server. Please wait...");
      return;
    }

    sendMessage("create-room", {
      roomName: roomName.trim(),
      userName: userName.trim(),
    });
    setError("");
  };

  const joinRoom = () => {
    if (!roomName.trim() || !userName.trim()) {
      setError("Please enter both room name and your name");
      return;
    }

    if (connectionStatus !== "connected") {
      setError("Not connected to server. Please wait...");
      return;
    }

    sendMessage("join-room", {
      roomName: roomName.trim(),
      userName: userName.trim(),
    });
    setError("");
  };

  const toggleVideo = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !isVideoEnabled;
        setIsVideoEnabled(!isVideoEnabled);
        sendMessage("toggle-video", { roomName, enabled: !isVideoEnabled });
      }
    }
  };

  const toggleAudio = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !isAudioEnabled;
        setIsAudioEnabled(!isAudioEnabled);
        sendMessage("toggle-audio", { roomName, enabled: !isAudioEnabled });
      }
    }
  };

  const leaveRoom = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track: any) => track.stop());
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
    }

    // Reset refs
    localStreamRef.current = null;
    peerConnectionRef.current = null;
    pendingCandidatesRef.current = [];
    shouldCreateOfferRef.current = false;

    // Reconnect WebSocket
    if (wsRef.current) {
      wsRef.current.close();
    }
    setTimeout(connectWebSocket, 1000);

    setIsInRoom(false);
    setCurrentView("home");
    setConnectedUsers([]);
    setRoomName("");
    setUserName("");
    setIsVideoEnabled(true);
    setIsAudioEnabled(true);
    setIsCreator(false);
  };

  const copyRoomName = () => {
    navigator.clipboard.writeText(roomName);
    setRoomCopied(true);
    setTimeout(() => setRoomCopied(false), 2000);
  };

  const getConnectionStatusColor = () => {
    switch (connectionStatus) {
      case "connected":
        return "text-green-400";
      case "error":
        return "text-red-400";
      default:
        return "text-yellow-400";
    }
  };

  const getConnectionStatusText = () => {
    switch (connectionStatus) {
      case "connected":
        return "Connected";
      case "error":
        return "Connection Error";
      default:
        return "Connecting...";
    }
  };

  const renderHome = () => (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-purple-900 to-indigo-900 flex items-center justify-center p-4">
      <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 w-full max-w-md border border-white/20">
        <div className="text-center mb-8">
          <Video className="w-16 h-16 text-white mx-auto mb-4" />
          <h1 className="text-3xl font-bold text-white mb-2">Video Call App</h1>
          <p className="text-white/80">
            Connect with others through video calls
          </p>

          {/* Connection Status */}
          <div className="mt-4 flex items-center justify-center space-x-2">
            <div
              className={`w-2 h-2 rounded-full ${
                connectionStatus === "connected"
                  ? "bg-green-400"
                  : connectionStatus === "error"
                  ? "bg-red-400"
                  : "bg-yellow-400"
              }`}
            ></div>
            <span className={`text-sm ${getConnectionStatusColor()}`}>
              {getConnectionStatusText()}
            </span>
          </div>
        </div>

        {error && (
          <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-3 mb-4">
            <p className="text-red-200 text-sm">{error}</p>
          </div>
        )}

        <div className="space-y-4 mb-6">
          <input
            type="text"
            placeholder="Your Name"
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
            className="w-full px-4 py-3 bg-white/10 border border-white/30 rounded-lg text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <input
            type="text"
            placeholder="Room Name"
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            className="w-full px-4 py-3 bg-white/10 border border-white/30 rounded-lg text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="space-y-3">
          <button
            onClick={createRoom}
            disabled={connectionStatus !== "connected"}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white py-3 rounded-lg font-semibold transition-colors"
          >
            Create Room
          </button>
          <button
            onClick={joinRoom}
            disabled={connectionStatus !== "connected"}
            className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white py-3 rounded-lg font-semibold transition-colors"
          >
            Join Room
          </button>
        </div>
      </div>
    </div>
  );

  const renderRoom = () => (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      {/* Header */}
      <div className="bg-gray-800 p-4 flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <Users className="w-5 h-5 text-white" />
            <span className="text-white font-semibold">Room: {roomName}</span>
          </div>
          <button
            onClick={copyRoomName}
            className="flex items-center space-x-1 bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded-lg transition-colors"
          >
            {roomCopied ? (
              <Check className="w-4 h-4 text-green-400" />
            ) : (
              <Copy className="w-4 h-4 text-white" />
            )}
            <span className="text-white text-sm">
              {roomCopied ? "Copied!" : "Copy"}
            </span>
          </button>
        </div>

        <div className="flex items-center space-x-2">
          <span className="text-white/80 text-sm">
            {connectedUsers.length}/2 users
          </span>
          <div
            className={`w-2 h-2 rounded-full ${getConnectionStatusColor().replace(
              "text-",
              "bg-"
            )}`}
          ></div>
        </div>
      </div>

      {/* Error display in room */}
      {error && (
        <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-3 m-4">
          <p className="text-red-200 text-sm">{error}</p>
        </div>
      )}

      {/* Video Container */}
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-6xl">
          {/* Local Video */}
          <div className="relative bg-gray-800 rounded-lg overflow-hidden aspect-video">
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              className="w-full h-full object-cover"
            />
            <div className="absolute bottom-4 left-4">
              <span className="bg-black/50 text-white px-2 py-1 rounded text-sm">
                You ({userName})
              </span>
            </div>
            {!isVideoEnabled && (
              <div className="absolute inset-0 bg-gray-700 flex items-center justify-center">
                <VideoOff className="w-12 h-12 text-gray-400" />
              </div>
            )}
          </div>

          {/* Remote Video */}
          <div className="relative bg-gray-800 rounded-lg overflow-hidden aspect-video">
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="w-full h-full object-cover"
            />
            {connectedUsers.length < 2 ? (
              <div className="absolute inset-0 bg-gray-700 flex flex-col items-center justify-center">
                <Users className="w-12 h-12 text-gray-400 mb-2" />
                <span className="text-gray-400">
                  Waiting for someone to join...
                </span>
              </div>
            ) : (
              <div className="absolute bottom-4 left-4">
                <span className="bg-black/50 text-white px-2 py-1 rounded text-sm">
                  {connectedUsers.find((u: any) => u.name !== userName)?.name ||
                    "Remote User"}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="bg-gray-800 p-4">
        <div className="flex items-center justify-center space-x-4">
          <button
            onClick={toggleAudio}
            className={`p-3 rounded-full transition-colors ${
              isAudioEnabled
                ? "bg-gray-700 hover:bg-gray-600 text-white"
                : "bg-red-600 hover:bg-red-700 text-white"
            }`}
          >
            {isAudioEnabled ? (
              <Mic className="w-6 h-6" />
            ) : (
              <MicOff className="w-6 h-6" />
            )}
          </button>

          <button
            onClick={toggleVideo}
            className={`p-3 rounded-full transition-colors ${
              isVideoEnabled
                ? "bg-gray-700 hover:bg-gray-600 text-white"
                : "bg-red-600 hover:bg-red-700 text-white"
            }`}
          >
            {isVideoEnabled ? (
              <Video className="w-6 h-6" />
            ) : (
              <VideoOff className="w-6 h-6" />
            )}
          </button>

          <button
            onClick={leaveRoom}
            className="p-3 bg-red-600 hover:bg-red-700 text-white rounded-full transition-colors"
          >
            <PhoneOff className="w-6 h-6" />
          </button>
        </div>
      </div>
    </div>
  );

  return currentView === "home" ? renderHome() : renderRoom();
};

export default VideoCallApp;