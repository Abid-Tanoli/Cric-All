// Cricket API integration service.
// Supports multiple external live-data providers.

import fetch from 'node-fetch';

const RAPIDAPI_CRICKET_HOST = process.env.RAPIDAPI_CRICKET_HOST || 'free-cricbuzz-cricket-api.p.rapidapi.com';

class CricketAPIService {
  constructor() {
    this.apiKey = process.env.CRICKET_API_KEY;
    this.apiProvider = process.env.CRICKET_API_PROVIDER || 'cricapi'; // cricapi, rapidapi-cricket
    this.baseUrl = this.getBaseUrl();
    this.cache = new Map();
    this.cacheTimeout = 8000; // 8 seconds cache
  }

  getBaseUrl() {
    switch (this.apiProvider) {
      case 'cricapi':
        return 'https://api.cricapi.com/v1';
      case 'rapidapi-cricket':
        return `https://${RAPIDAPI_CRICKET_HOST}`;
      default:
        return 'https://api.cricapi.com/v1';
    }
  }

  // Get headers based on API provider
  getHeaders() {
    switch (this.apiProvider) {
      case 'cricapi':
        return {
          'Content-Type': 'application/json',
        };
      case 'rapidapi-cricket':
        return {
          'Content-Type': 'application/json',
          'X-RapidAPI-Key': this.apiKey,
          'X-RapidAPI-Host': RAPIDAPI_CRICKET_HOST,
        };
      default:
        return { 'Content-Type': 'application/json' };
    }
  }

  // Make API request with error handling
  async makeRequest(endpoint, params = {}) {
    const cacheKey = `${endpoint}_${JSON.stringify(params)}`;
    
    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      console.log('[LiveCricketAPI] Using cached data for:', endpoint);
      return cached.data;
    }

    try {
      console.log('[LiveCricketAPI] Fetching from external API:', endpoint);
      
      let url = `${this.baseUrl}${endpoint}`;
      
      // Add query parameters
      const queryParams = new URLSearchParams({
        ...params,
        apikey: this.apiProvider === 'cricapi' ? this.apiKey : undefined,
      }).toString();
      
      if (queryParams) {
        url += `?${queryParams}`;
      }

      const response = await fetch(url, {
        method: 'GET',
        headers: this.getHeaders(),
        timeout: 15000,
      });

      if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      // Cache the response
      this.cache.set(cacheKey, {
        data,
        timestamp: Date.now(),
      });

      // Clean old cache entries
      this.cleanCache();

      return data;
    } catch (error) {
      console.error('[LiveCricketAPI] Error fetching data:', error.message);
      throw error;
    }
  }

  // Clean expired cache entries
  cleanCache() {
    const now = Date.now();
    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp > this.cacheTimeout * 2) {
        this.cache.delete(key);
      }
    }
  }

  // Transform a standard live-provider match response to our format.
  transformStandardProviderMatch(match) {
    return {
      id: match.id,
      name: match.name || 'Unknown Match',
      matchType: match.matchType || 'T20',
      status: this.normalizeStatus(match.status),
      venue: match.venue || 'TBD',
      date: match.date,
      dateTimeGMT: match.dateTimeGMT,
      teams: {
        team1: {
          name: match.t1?.name || 'Team 1',
          shortName: match.t1?.shortname || 'T1',
          logo: match.t1?.img || '',
        },
        team2: {
          name: match.t2?.name || 'Team 2',
          shortName: match.t2?.shortname || 'T2',
          logo: match.t2?.img || '',
        },
      },
      score: match.score || [],
      toss: match.toss ? `${match.toss} ${match.toss_result}` : '',
      result: match.result || '',
      currentRunRate: match.current_run_rate || null,
      requiredRunRate: match.required_run_rate || null,
      overs: match.overs || null,
      live: match.matchStarted && !match.matchEnded,
    };
  }

  // Transform an alternate live-provider match response to our format.
  transformAlternateProviderMatch(match) {
    return {
      id: match.matchInfo?.matchId || match.matchInfo?.id,
      name: match.matchInfo?.team1?.name + ' vs ' + match.matchInfo?.team2?.name,
      matchType: match.matchInfo?.matchType || 'T20',
      status: this.normalizeStatus(match.matchInfo?.status),
      venue: match.matchInfo?.venue?.name || 'TBD',
      date: match.matchInfo?.startDate,
      dateTimeGMT: match.matchInfo?.startDate,
      teams: {
        team1: {
          name: match.matchInfo?.team1?.name || 'Team 1',
          shortName: match.matchInfo?.team1?.shortName || 'T1',
          logo: '',
        },
        team2: {
          name: match.matchInfo?.team2?.name || 'Team 2',
          shortName: match.matchInfo?.team2?.shortName || 'T2',
          logo: '',
        },
      },
      score: match.scoreCard || [],
      toss: match.matchInfo?.toss?.resultText || '',
      result: match.matchInfo?.status || '',
      currentRunRate: match.currentRunRate || null,
      requiredRunRate: match.requiredRunRate || null,
      overs: null,
      live: match.matchInfo?.matchStarted && !match.matchInfo?.matchEnded,
    };
  }

  // Normalize match status
  normalizeStatus(status) {
    if (!status) return 'upcoming';
    
    const lowerStatus = status.toLowerCase();
    
    if (lowerStatus.includes('live') || lowerStatus.includes('in progress')) {
      return 'live';
    } else if (lowerStatus.includes('complete') || lowerStatus.includes('result') || lowerStatus.includes('won')) {
      return 'completed';
    } else if (lowerStatus.includes('abandoned') || lowerStatus.includes('cancelled')) {
      return 'abandoned';
    } else if (lowerStatus.includes('upcoming') || lowerStatus.includes('scheduled')) {
      return 'upcoming';
    }
    
    return 'upcoming';
  }

  // Get all live matches
  async getLiveMatches() {
    try {
      let data;
      
      if (this.apiProvider === 'cricapi') {
        data = await this.makeRequest('/matches', {
          status: 'live',
        });
        
        if (data.status === 'success' && data.data) {
          return data.data
            .filter(m => m.matchStarted && !m.matchEnded)
            .map(m => this.transformStandardProviderMatch(m));
        }
      } else if (this.apiProvider === 'rapidapi-cricket') {
        data = await this.makeRequest('/matches/v1/live');
        
        if (data.typeMatches) {
          const allMatches = data.typeMatches.flatMap(t => t.seriesMatches || []);
          return allMatches
            .filter(m => m.matchInfo?.matchStarted && !m.matchInfo?.matchEnded)
            .map(m => this.transformAlternateProviderMatch(m));
        }
      }
      
      return [];
    } catch (error) {
      console.error('[LiveCricketAPI] Error fetching live matches:', error);
      return [];
    }
  }

  // Get upcoming matches
  async getUpcomingMatches() {
    try {
      let data;
      
      if (this.apiProvider === 'cricapi') {
        data = await this.makeRequest('/matches', {
          status: 'upcoming',
        });
        
        if (data.status === 'success' && data.data) {
          return data.data
            .filter(m => !m.matchStarted)
            .map(m => this.transformStandardProviderMatch(m));
        }
      }
      
      return [];
    } catch (error) {
      console.error('[LiveCricketAPI] Error fetching upcoming matches:', error);
      return [];
    }
  }

  // Get completed matches
  async getCompletedMatches() {
    try {
      let data;
      
      if (this.apiProvider === 'cricapi') {
        data = await this.makeRequest('/matches', {
          status: 'completed',
        });
        
        if (data.status === 'success' && data.data) {
          return data.data
            .filter(m => m.matchEnded)
            .map(m => this.transformStandardProviderMatch(m));
        }
      }
      
      return [];
    } catch (error) {
      console.error('[LiveCricketAPI] Error fetching completed matches:', error);
      return [];
    }
  }

  // Get all matches (live + upcoming + recent)
  async getAllMatches() {
    try {
      let data;
      
      if (this.apiProvider === 'cricapi') {
        data = await this.makeRequest('/matches');
        
        if (data.status === 'success' && data.data) {
          return data.data.map(m => this.transformStandardProviderMatch(m));
        }
      } else if (this.apiProvider === 'rapidapi-cricket') {
        data = await this.makeRequest('/matches/v1/recent');
        
        if (data.typeMatches) {
          const allMatches = data.typeMatches.flatMap(t => t.seriesMatches || []);
          return allMatches.map(m => this.transformAlternateProviderMatch(m));
        }
      }
      
      return [];
    } catch (error) {
      console.error('[LiveCricketAPI] Error fetching all matches:', error);
      return [];
    }
  }

  // Get detailed match information (scorecard)
  async getMatchInfo(matchId) {
    try {
      let data;
      
      if (this.apiProvider === 'cricapi') {
        data = await this.makeRequest(`/cricketScore/${matchId}`);
        
        if (data.status === 'success') {
          return this.transformStandardProviderMatch(data.data);
        }
      } else if (this.apiProvider === 'rapidapi-cricket') {
        data = await this.makeRequest(`/mcenter/view/${matchId}`);
        
        if (data) {
          return this.transformAlternateProviderMatch(data);
        }
      }
      
      return null;
    } catch (error) {
      console.error('[LiveCricketAPI] Error fetching match info:', error);
      return null;
    }
  }

  // Get ball-by-ball commentary
  async getCommentary(matchId) {
    try {
      let data;
      
      if (this.apiProvider === 'cricapi') {
        data = await this.makeRequest(`/matchCommentary/${matchId}`);
        return data;
      } else if (this.apiProvider === 'rapidapi-cricket') {
        data = await this.makeRequest(`/mcenter/commentary/${matchId}`);
        return data;
      }
      
      return null;
    } catch (error) {
      console.error('[LiveCricketAPI] Error fetching commentary:', error);
      return null;
    }
  }

  // Get full scorecard
  async getScorecard(matchId) {
    try {
      let data;
      
      if (this.apiProvider === 'cricapi') {
        data = await this.makeRequest(`/cricketScore/${matchId}`);
        
        if (data.status === 'success') {
          return {
            matchInfo: this.transformStandardProviderMatch(data.data),
            innings: data.data.score || [],
            batsmen: data.data.batsman || [],
            bowlers: data.data.bowler || [],
          };
        }
      } else if (this.apiProvider === 'rapidapi-cricket') {
        data = await this.makeRequest(`/mcenter/scorecard/${matchId}`);
        return data;
      }
      
      return null;
    } catch (error) {
      console.error('[LiveCricketAPI] Error fetching scorecard:', error);
      return null;
    }
  }

  // Clear cache manually
  clearCache() {
    this.cache.clear();
    console.log('[LiveCricketAPI] Cache cleared');
  }
}

// Export singleton instance
export default new CricketAPIService();
