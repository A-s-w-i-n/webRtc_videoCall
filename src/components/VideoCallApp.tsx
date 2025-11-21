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
  const [ws, setWs] = useState(null);
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
  console.log(ws, isInRoom, isCreator);

  // WebRTC refs
  const localVideoRef = useRef<any>(null);
  const remoteVideoRef = useRef<any>(null);
  const localStreamRef = useRef<any>(null);
  const peerConnectionRef = useRef<any>(null);
  const pendingCandidatesRef = useRef<any>([]);
  const wsRef = useRef<any>(null);
  const shouldCreateOfferRef = useRef<any>(false);
  const isCreatorRef = useRef<any>(false);
  const remoteMediaStreamRef = useRef<any>(null);
  const roomNameRef = useRef<any>("");

  const safePlay = (videoEl: any) => {
    if (!videoEl) return;
    const playPromise = videoEl.play();
    if (playPromise && typeof playPromise.then === "function") {
      playPromise.catch(() => {
        // ignore autoplay policy rejections
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

  const sendMessage = useCallback((type: any, data: any) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, ...data }));
      console.log("Sent message:", type, data);
    } else {  
      console.warn("WebSocket not ready, cannot send:", type);
    }
  }, []);

  const createPeerConnection = useCallback(() => {
    console.log("Creating peer connection...");
    const pc = new RTCPeerConnection(iceServers);

    // Initialize remote stream
    if (!remoteMediaStreamRef.current) {
      remoteMediaStreamRef.current = new MediaStream();
      console.log("Created new remote MediaStream");
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log("Sending ICE candidate");
        sendMessage("ice-candidate", {
          candidate: event.candidate,
          roomName: roomNameRef.current,
        });
      }
    };

    pc.ontrack = (event) => {
      console.log("Received remote track:", event.track.kind, event.streams);

      // Add track to remote stream
      if (
        event.track &&
        !remoteMediaStreamRef.current.getTracks().includes(event.track)
      ) {
        remoteMediaStreamRef.current.addTrack(event.track);
        console.log(
          "Added track to remote stream. Total tracks:",
          remoteMediaStreamRef.current.getTracks().length
        );
      }

      // Attach stream to video element
      if (remoteVideoRef.current) {
        if (remoteVideoRef.current.srcObject !== remoteMediaStreamRef.current) {
          remoteVideoRef.current.srcObject = remoteMediaStreamRef.current;
          console.log("Attached remote stream to video element");
        }
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
  }, [sendMessage]);

  const addLocalTracks = useCallback((pc: any) => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track: any) => {
        console.log("Adding local track to peer connection:", track.kind);
        pc.addTrack(track, localStreamRef.current);
      });
    } else {
      console.warn("No local stream available to add tracks");
    }
  }, []);

  const createOffer = useCallback(async () => {
    try {
      console.log("Creating offer...");

      if (!localStreamRef.current) {
        console.error("No local stream available for offer");
        return;
      }

      // Close existing peer connection if any
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }

      peerConnectionRef.current = createPeerConnection();
      addLocalTracks(peerConnectionRef.current);

      const offer = await peerConnectionRef.current.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });

      await peerConnectionRef.current.setLocalDescription(offer);
      console.log("Sending offer");

      sendMessage("offer", {
        offer,
        roomName: roomNameRef.current,
      });
    } catch (error) {
      console.error("Error creating offer:", error);
      setError("Failed to create call offer");
    }
  }, [createPeerConnection, addLocalTracks, sendMessage]);

  const createAnswer = useCallback(
    async (offer: any) => {
      try {
        console.log("Creating answer...");

        if (!localStreamRef.current) {
          console.error("No local stream available for answer");
          return;
        }

        // Close existing peer connection if any
        if (peerConnectionRef.current) {
          peerConnectionRef.current.close();
        }

        peerConnectionRef.current = createPeerConnection();

        console.log("Setting remote description from offer");
        await peerConnectionRef.current.setRemoteDescription(
          new RTCSessionDescription(offer)
        );

        // Add local tracks
        addLocalTracks(peerConnectionRef.current);

        // Process any buffered ICE candidates
        console.log(
          "Processing",
          pendingCandidatesRef.current.length,
          "pending ICE candidates"
        );
        for (const candidate of pendingCandidatesRef.current) {
          try {
            await peerConnectionRef.current.addIceCandidate(
              new RTCIceCandidate(candidate)
            );
          } catch (e) {
            console.warn("Failed adding buffered ICE candidate", e);
          }
        }
        pendingCandidatesRef.current = [];

        const answer = await peerConnectionRef.current.createAnswer();
        await peerConnectionRef.current.setLocalDescription(answer);
        console.log("Sending answer");

        sendMessage("answer", {
          answer,
          roomName: roomNameRef.current,
        });
      } catch (error) {
        console.error("Error creating answer:", error);
        setError("Failed to answer call");
      }
    },
    [createPeerConnection, addLocalTracks, sendMessage]
  );

  const handleWebSocketMessage = useCallback(
    (data: any) => {
      const { type, ...payload } = data;
      console.log("Received message:", type, payload);

      switch (type) {
        case "room-created":
          setIsInRoom(true);
          setCurrentView("room");
          setIsCreator(true);
          isCreatorRef.current = true;
          break;

        case "room-joined":
          setIsInRoom(true);
          setCurrentView("room");
          setIsCreator(false);
          isCreatorRef.current = false;
          setConnectedUsers(payload.users || []);
          break;

        case "user-joined":
          console.log("User joined, users:", payload.users);
          setConnectedUsers(payload.users || []);

          // Creator initiates offer when second user joins
          if (
            isCreatorRef.current &&
            payload.users &&
            payload.users.length === 4
          ) {
            console.log("Room full, creator will create offer");
            setTimeout(() => {
              if (localStreamRef.current) {
                createOffer();
              } else {
                shouldCreateOfferRef.current = true;
              }
            }, 1000);
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
          remoteMediaStreamRef.current = null;
          pendingCandidatesRef.current = [];
          break;

        case "offer":
          console.log("Received offer");
          createAnswer(payload.offer);
          break;

        case "answer":
          console.log("Received answer");
          if (peerConnectionRef.current) {
            peerConnectionRef.current
              .setRemoteDescription(new RTCSessionDescription(payload.answer))
              .then(() => {
                console.log("Remote description set successfully");
                // Add any pending ICE candidates
                console.log(
                  "Processing",
                  pendingCandidatesRef.current.length,
                  "pending candidates"
                );
                for (const candidate of pendingCandidatesRef.current) {
                  peerConnectionRef.current.addIceCandidate(
                    new RTCIceCandidate(candidate)
                  );
                }
                pendingCandidatesRef.current = [];
              })
              .catch((err: any) => {
                console.error("Error setting remote description:", err);
              });
          }
          break;

        case "ice-candidate":
          console.log("Received ICE candidate");
          if (
            peerConnectionRef.current &&
            peerConnectionRef.current.remoteDescription
          ) {
            peerConnectionRef.current
              .addIceCandidate(new RTCIceCandidate(payload.candidate))
              .catch((err: any) => {
                console.error("Error adding ICE candidate:", err);
              });
          } else {
            console.log("Buffering ICE candidate");
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
    [createOffer, createAnswer]
  );

  const connectWebSocket = useCallback(() => {
    try {
      // const websocket : any = new WebSocket("ws://localhost:3001");
      const websocket: any = new WebSocket(
        "wss://videocallbackend-sv45.onrender.com"
      );
      wsRef.current = websocket;

      websocket.onopen = () => {
        console.log("WebSocket connected");
        setConnectionStatus("connected");
        setWs(websocket);
        setError("");
      };

      websocket.onmessage = (event: any) => {
        const data = JSON.parse(event.data);
        handleWebSocketMessage(data);
      };

      websocket.onclose = (event: any) => {
        console.log("WebSocket disconnected", {
          code: event.code,
          reason: event.reason,
        });
        setConnectionStatus("disconnected");
        setWs(null);
        setTimeout(connectWebSocket, 3000);
      };

      websocket.onerror = (error: any) => {
        console.error("WebSocket error:", error);
        setError("Connection failed. Retrying...");
        setConnectionStatus("error");
      };
    } catch (error) {
      console.error("WebSocket connection error:", error);
      setError("Failed to connect to server");
    }
  }, [handleWebSocketMessage]);

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

        console.log(
          "Media initialized, tracks:",
          stream.getTracks().map((t) => t.kind)
        );

        // If we were waiting to create an offer, do it now
        if (shouldCreateOfferRef.current) {
          shouldCreateOfferRef.current = false;
          setTimeout(createOffer, 500);
        }
      } catch (err) {
        console.error("Error accessing media devices:", err);
        setError("Could not access camera/microphone");
      }
    };

    if (currentView === "room" && !localStreamRef.current) {
      initializeMedia();
    }
  }, [currentView, createOffer]);

  // Keep roomName in ref for WebSocket messages
  useEffect(() => {
    roomNameRef.current = roomName;
  }, [roomName]);

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
    remoteMediaStreamRef.current = null;
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

      {error && (
        <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-3 m-4">
          <p className="text-red-200 text-sm">{error}</p>
        </div>
      )}

      <div className="flex-1 flex items-center justify-center p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-6xl">
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
