from fastapi import FastAPI, APIRouter, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import json
import asyncio
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from datetime import datetime, timezone

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app
app = FastAPI(title="Renault Talisman GPS Navigator 3D")

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# WebSocket Connection Manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []
    
    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
    
    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
    
    async def broadcast(self, message: str):
        for connection in self.active_connections[:]:
            try:
                await connection.send_text(message)
            except:
                await self.disconnect_safely(connection)
    
    async def disconnect_safely(self, websocket: WebSocket):
        try:
            await websocket.close()
        except:
            pass
        self.disconnect(websocket)

manager = ConnectionManager()

# Pydantic Models
class GPSPosition(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    latitude: float
    longitude: float
    altitude: Optional[float] = None
    speed: Optional[float] = None
    heading: Optional[float] = None
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class RouteRequest(BaseModel):
    start_lat: float
    start_lng: float
    end_lat: float
    end_lng: float
    vehicle_type: str = "car"
    avoid_tolls: bool = False

class FavoriteLocation(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    address: str
    latitude: float
    longitude: float
    category: str = "general"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class NavigationSession(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    start_location: dict
    destination: dict
    route_data: Optional[dict] = None
    started_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    status: str = "active"

# API Routes
@api_router.get("/")
async def root():
    return {"message": "Renault Talisman GPS 3D Navigator API", "version": "1.0.0"}

@api_router.post("/gps/position", response_model=GPSPosition)
async def update_gps_position(position: GPSPosition):
    """Update current GPS position"""
    position_dict = position.dict()
    position_dict['timestamp'] = position_dict['timestamp'].isoformat()
    
    # Store in database
    await db.gps_positions.insert_one(position_dict)
    
    # Broadcast to connected clients
    await manager.broadcast(json.dumps({
        "type": "gps_update",
        "data": position_dict
    }))
    
    return position

@api_router.get("/gps/current")
async def get_current_position():
    """Get the most recent GPS position"""
    position = await db.gps_positions.find_one(
        {}, 
        sort=[("timestamp", -1)]
    )
    if position:
        position['_id'] = str(position['_id'])
        return position
    return {"message": "No GPS data available"}

@api_router.post("/route/calculate")
async def calculate_route(route_request: RouteRequest):
    """Calculate route between two points"""
    # This would integrate with MapBox Directions API
    # For now, return mock data
    route_data = {
        "distance": "42.3 km",
        "duration": "35 minutes",
        "steps": [
            {"instruction": "Démarrer sur Avenue de la République", "distance": "0.5 km"},
            {"instruction": "Tourner à droite sur Boulevard Haussmann", "distance": "2.1 km"},
            {"instruction": "Continuer tout droit sur A1", "distance": "38.7 km"},
            {"instruction": "Sortie 15 vers destination", "distance": "1.0 km"}
        ],
        "coordinates": [
            [route_request.start_lng, route_request.start_lat],
            [route_request.start_lng + 0.01, route_request.start_lat + 0.01],
            [route_request.end_lng - 0.01, route_request.end_lat - 0.01],
            [route_request.end_lng, route_request.end_lat]
        ]
    }
    
    # Store navigation session
    session = NavigationSession(
        start_location={"lat": route_request.start_lat, "lng": route_request.start_lng},
        destination={"lat": route_request.end_lat, "lng": route_request.end_lng},
        route_data=route_data
    )
    
    session_dict = session.dict()
    session_dict['started_at'] = session_dict['started_at'].isoformat()
    await db.navigation_sessions.insert_one(session_dict)
    
    return {"route": route_data, "session_id": session.id}

@api_router.post("/favorites", response_model=FavoriteLocation)
async def add_favorite_location(location: FavoriteLocation):
    """Add a favorite location"""
    location_dict = location.dict()
    location_dict['created_at'] = location_dict['created_at'].isoformat()
    
    await db.favorite_locations.insert_one(location_dict)
    return location

@api_router.get("/favorites", response_model=List[FavoriteLocation])
async def get_favorite_locations():
    """Get all favorite locations"""
    favorites = await db.favorite_locations.find().to_list(1000)
    result = []
    for fav in favorites:
        fav['_id'] = str(fav['_id'])
        result.append(FavoriteLocation(**fav))
    return result

@api_router.delete("/favorites/{location_id}")
async def delete_favorite_location(location_id: str):
    """Delete a favorite location"""
    result = await db.favorite_locations.delete_one({"id": location_id})
    if result.deleted_count:
        return {"message": "Location supprimée avec succès"}
    return {"message": "Location non trouvée"}

@api_router.get("/navigation/history")
async def get_navigation_history():
    """Get navigation history"""
    history = await db.navigation_sessions.find({}, sort=[("started_at", -1)]).to_list(50)
    for session in history:
        session['_id'] = str(session['_id'])
    return {"history": history}

# WebSocket endpoint for real-time updates
@api_router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # Keep connection alive and handle incoming messages
            data = await websocket.receive_text()
            message = json.loads(data)
            
            # Handle different message types
            if message.get("type") == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
            elif message.get("type") == "request_position":
                # Send current position to this specific client
                current_pos = await db.gps_positions.find_one({}, sort=[("timestamp", -1)])
                if current_pos:
                    current_pos['_id'] = str(current_pos['_id'])
                    await websocket.send_text(json.dumps({
                        "type": "position_update",
                        "data": current_pos
                    }))
                    
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()