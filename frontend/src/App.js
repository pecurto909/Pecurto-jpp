import React, { useState, useEffect, useRef } from 'react';
import './App.css';
import { Card } from './components/ui/card';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Badge } from './components/ui/badge';
import { Navigation, MapPin, Star, Settings, Route, Compass, Car, Mountain, Zap } from 'lucide-react';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// Mock MapBox token - User needs to provide real token
const MAPBOX_TOKEN = 'pk.your_mapbox_token_here';

function App() {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const [lng, setLng] = useState(2.3522);
  const [lat, setLat] = useState(48.8566);
  const [zoom, setZoom] = useState(14);
  const [currentPosition, setCurrentPosition] = useState(null);
  const [isNavigating, setIsNavigating] = useState(false);
  const [routeInfo, setRouteInfo] = useState(null);
  const [favorites, setFavorites] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [destination, setDestination] = useState('');
  const [view3D, setView3D] = useState(false);
  const [terrainEnabled, setTerrainEnabled] = useState(true);

  // Initialize MapBox map
  useEffect(() => {
    if (map.current) return; // Initialize map only once
    
    // Note: This requires MapBox GL JS to be loaded
    // In a real implementation, you would load mapbox-gl via CDN or npm
    if (window.mapboxgl) {
      window.mapboxgl.accessToken = MAPBOX_TOKEN;
      
      map.current = new window.mapboxgl.Map({
        container: mapContainer.current,
        style: 'mapbox://styles/mapbox/satellite-streets-v12',
        center: [lng, lat],
        zoom: zoom,
        pitch: view3D ? 60 : 0,
        bearing: 0,
        antialias: true
      });

      // Add 3D terrain when map loads
      map.current.on('load', () => {
        // Add terrain data source
        if (terrainEnabled) {
          map.current.addSource('mapbox-dem', {
            'type': 'raster-dem',
            'url': 'mapbox://mapbox.mapbox-terrain-dem-v1',
            'tileSize': 512,
            'maxzoom': 14
          });
          
          // Add terrain layer
          map.current.setTerrain({ 'source': 'mapbox-dem', 'exaggeration': 1.5 });
          
          // Add sky layer
          map.current.addLayer({
            'id': 'sky',
            'type': 'sky',
            'paint': {
              'sky-type': 'atmosphere',
              'sky-atmosphere-sun': [0.0, 0.0],
              'sky-atmosphere-sun-intensity': 15
            }
          });
        }
      });

      // Add navigation controls
      map.current.addControl(new window.mapboxgl.NavigationControl());
      
      // Add current position marker
      const marker = new window.mapboxgl.Marker({ color: '#3b82f6' })
        .setLngLat([lng, lat])
        .addTo(map.current);
    }
  }, []);

  // Update 3D view
  useEffect(() => {
    if (map.current) {
      map.current.easeTo({
        pitch: view3D ? 60 : 0,
        bearing: view3D ? 45 : 0,
        duration: 1000
      });
    }
  }, [view3D]);

  // Get user's current location
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const pos = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            speed: position.coords.speed,
            heading: position.coords.heading
          };
          setCurrentPosition(pos);
          setLat(pos.latitude);
          setLng(pos.longitude);
          
          if (map.current) {
            map.current.flyTo({
              center: [pos.longitude, pos.latitude],
              zoom: 16,
              duration: 2000
            });
          }
        },
        (error) => {
          console.error('Erreur de géolocalisation:', error);
        },
        { enableHighAccuracy: true }
      );
    }
  }, []);

  // WebSocket connection for real-time updates
  useEffect(() => {
    const wsUrl = `${BACKEND_URL}/api/ws`.replace('https:', 'wss:').replace('http:', 'ws:');
    const ws = new WebSocket(wsUrl);
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'gps_update') {
        setCurrentPosition(data.data);
      }
    };
    
    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
    
    return () => {
      ws.close();
    };
  }, []);

  const startNavigation = async () => {
    if (!destination || !currentPosition) return;
    
    try {
      const response = await fetch(`${API}/route/calculate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start_lat: currentPosition.latitude,
          start_lng: currentPosition.longitude,
          end_lat: lat,
          end_lng: lng,
          vehicle_type: 'car'
        })
      });
      
      const data = await response.json();
      setRouteInfo(data.route);
      setIsNavigating(true);
    } catch (error) {
      console.error('Erreur de calcul d\'itinéraire:', error);
    }
  };

  const addToFavorites = async () => {
    if (!searchQuery) return;
    
    try {
      await fetch(`${API}/favorites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: searchQuery,
          address: searchQuery,
          latitude: lat,
          longitude: lng,
          category: 'user_added'
        })
      });
      
      // Refresh favorites
      loadFavorites();
    } catch (error) {
      console.error('Erreur lors de l\'ajout aux favoris:', error);
    }
  };

  const loadFavorites = async () => {
    try {
      const response = await fetch(`${API}/favorites`);
      const data = await response.json();
      setFavorites(data);
    } catch (error) {
      console.error('Erreur de chargement des favoris:', error);
    }
  };

  useEffect(() => {
    loadFavorites();
  }, []);

  return (
    <div className="App">
      {/* Header */}
      <header className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white p-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="bg-gradient-to-br from-blue-500 to-cyan-400 p-3 rounded-xl">
              <Navigation className="h-8 w-8" />
            </div>
            <div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">
                RENAULT TALISMAN
              </h1>
              <p className="text-slate-300 text-sm">Navigateur GPS 3D</p>
            </div>
          </div>
          
          <div className="flex items-center space-x-4">
            {currentPosition && (
              <Badge variant="outline" className="text-green-400 border-green-400">
                <Zap className="w-4 h-4 mr-1" />
                GPS Actif
              </Badge>
            )}
            
            <Button
              variant={view3D ? "default" : "outline"}
              size="sm"
              onClick={() => setView3D(!view3D)}
              className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
            >
              <Mountain className="w-4 h-4 mr-1" />
              Vue 3D
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex h-screen bg-slate-50">
        {/* Sidebar */}
        <div className="w-96 bg-white shadow-xl border-r border-slate-200 flex flex-col">
          {/* Search Section */}
          <div className="p-6 border-b border-slate-200">
            <div className="space-y-4">
              <div className="relative">
                <MapPin className="absolute left-3 top-3 h-5 w-5 text-slate-400" />
                <Input
                  placeholder="Rechercher une destination..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 h-12 text-lg border-2 border-slate-200 focus:border-blue-500 rounded-xl"
                />
              </div>
              
              <div className="grid grid-cols-2 gap-3">
                <Button
                  onClick={startNavigation}
                  disabled={!searchQuery || !currentPosition}
                  className="h-12 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 rounded-xl font-semibold"
                >
                  <Route className="w-5 h-5 mr-2" />
                  Navigation
                </Button>
                
                <Button
                  variant="outline"
                  onClick={addToFavorites}
                  className="h-12 border-2 border-yellow-400 text-yellow-600 hover:bg-yellow-50 rounded-xl font-semibold"
                >
                  <Star className="w-5 h-5 mr-2" />
                  Favoris
                </Button>
              </div>
            </div>
          </div>

          {/* Route Information */}
          {routeInfo && (
            <div className="p-6 bg-gradient-to-br from-blue-50 to-cyan-50 border-b border-slate-200">
              <Card className="p-4 border-2 border-blue-200 shadow-lg">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-bold text-slate-800 flex items-center">
                    <Car className="w-5 h-5 mr-2 text-blue-600" />
                    Itinéraire calculé
                  </h3>
                  {isNavigating && (
                    <Badge className="bg-green-500 text-white animate-pulse">
                      En cours
                    </Badge>
                  )}
                </div>
                
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-slate-800">{routeInfo.distance}</p>
                    <p className="text-sm text-slate-600">Distance</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-slate-800">{routeInfo.duration}</p>
                    <p className="text-sm text-slate-600">Durée</p>
                  </div>
                </div>
                
                <div className="space-y-2">
                  {routeInfo.steps?.slice(0, 3).map((step, index) => (
                    <div key={index} className="flex items-start space-x-3 p-2 bg-white rounded-lg">
                      <div className="bg-blue-500 text-white text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center">
                        {index + 1}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-slate-800">{step.instruction}</p>
                        <p className="text-xs text-slate-600">{step.distance}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          )}

          {/* Favorites */}
          <div className="flex-1 overflow-y-auto p-6">
            <h3 className="font-bold text-slate-800 mb-4 flex items-center">
              <Star className="w-5 h-5 mr-2 text-yellow-500" />
              Lieux favoris
            </h3>
            
            <div className="space-y-3">
              {favorites.length === 0 ? (
                <p className="text-slate-500 text-center py-8">Aucun favori enregistré</p>
              ) : (
                favorites.map((fav) => (
                  <Card key={fav.id} className="p-4 hover:shadow-md transition-shadow cursor-pointer border border-slate-200">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h4 className="font-semibold text-slate-800">{fav.name}</h4>
                        <p className="text-sm text-slate-600">{fav.address}</p>
                      </div>
                      <Star className="w-5 h-5 text-yellow-500 fill-current" />
                    </div>
                  </Card>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Map Container */}
        <div className="flex-1 relative">
          <div ref={mapContainer} className="w-full h-full" />
          
          {/* Map Controls Overlay */}
          <div className="absolute top-4 right-4 space-y-2">
            <Card className="p-2 bg-white/90 backdrop-blur-sm shadow-lg">
              <div className="flex flex-col space-y-2">
                <Button
                  size="sm"
                  variant={terrainEnabled ? "default" : "outline"}
                  onClick={() => setTerrainEnabled(!terrainEnabled)}
                  className="text-xs"
                >
                  <Mountain className="w-4 h-4 mr-1" />
                  Terrain 3D
                </Button>
                
                <Button size="sm" variant="outline" className="text-xs">
                  <Compass className="w-4 h-4 mr-1" />
                  Centrer
                </Button>
              </div>
            </Card>
          </div>

          {/* Speed and GPS Info */}
          {currentPosition && (
            <div className="absolute bottom-4 left-4">
              <Card className="p-4 bg-black/80 backdrop-blur-sm text-white shadow-xl">
                <div className="flex items-center space-x-4">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-cyan-400">
                      {currentPosition.speed ? Math.round(currentPosition.speed * 3.6) : '0'}
                    </p>
                    <p className="text-xs text-slate-300">km/h</p>
                  </div>
                  
                  <div className="text-center">
                    <p className="text-sm font-medium text-slate-200">
                      {currentPosition.latitude?.toFixed(6)}
                    </p>
                    <p className="text-sm font-medium text-slate-200">
                      {currentPosition.longitude?.toFixed(6)}
                    </p>
                    <p className="text-xs text-slate-400">Coordonnées GPS</p>
                  </div>
                </div>
              </Card>
            </div>
          )}
        </div>
      </div>

      {/* Note about MapBox token */}
      {MAPBOX_TOKEN === 'pk.your_mapbox_token_here' && (
        <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50">
          <Card className="p-6 max-w-md bg-yellow-50 border-2 border-yellow-400 shadow-xl">
            <div className="text-center">
              <h3 className="font-bold text-yellow-800 mb-2">Configuration requise</h3>
              <p className="text-yellow-700 text-sm">
                Pour afficher la carte 3D, veuillez fournir votre clé d'API MapBox.
                Obtenez-la gratuitement sur mapbox.com
              </p>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

export default App;