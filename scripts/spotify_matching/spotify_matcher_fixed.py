import pandas as pd
import requests
import base64
import time
import os
from difflib import SequenceMatcher
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# ============================================
# CONFIGURATION
# ============================================
CLIENT_ID = os.getenv('SPOTIFY_CLIENT_ID')
CLIENT_SECRET = os.getenv('SPOTIFY_CLIENT_SECRET')
INPUT_FILE = 'artists_to_match.csv'
OUTPUT_FILE = 'spotify_matches_final.csv'

# ============================================
# STEP 1: Get Spotify Access Token
# ============================================
def get_access_token():
    if not CLIENT_ID or not CLIENT_SECRET:
        print("\n❌ ERROR: Spotify credentials not found!")
        print("Make sure you have a .env file with:")
        print("  SPOTIFY_CLIENT_ID=your_client_id")
        print("  SPOTIFY_CLIENT_SECRET=your_client_secret")
        exit(1)
    
    auth_string = f"{CLIENT_ID}:{CLIENT_SECRET}"
    auth_bytes = auth_string.encode('utf-8')
    auth_base64 = base64.b64encode(auth_bytes).decode('utf-8')
    
    url = 'https://accounts.spotify.com/api/token'
    headers = {'Authorization': f'Basic {auth_base64}'}
    data = {'grant_type': 'client_credentials'}
    
    response = requests.post(url, headers=headers, data=data)
    
    if response.status_code != 200:
        print(f"ERROR: Failed to get access token. Status code: {response.status_code}")
        print(f"Response: {response.text}")
        exit(1)
    
    return response.json()['access_token']

# ============================================
# STEP 2: Calculate Match Confidence
# ============================================
def calculate_confidence(original, spotify_match):
    """Calculate how confident we are in the match"""
    original_clean = original.lower().strip().replace('the ', '').replace('&', 'and')
    spotify_clean = spotify_match.lower().strip().replace('the ', '').replace('&', 'and')
    
    # Exact match
    if original_clean == spotify_clean:
        return 'exact'
    
    # Calculate similarity ratio
    similarity = SequenceMatcher(None, original_clean, spotify_clean).ratio()
    
    if similarity > 0.95:
        return 'high'
    elif similarity > 0.85:
        return 'medium'
    else:
        return 'low'

# ============================================
# STEP 3: Search Spotify for Artist (FIXED)
# ============================================
def search_spotify_artist(artist_name, access_token):
    """Search Spotify API for an artist with proper rate limit handling"""
    headers = {'Authorization': f'Bearer {access_token}'}
    params = {
        'q': f'artist:"{artist_name}"',  # More precise query
        'type': 'artist',
        'limit': 5  # Get top 5 to find best match
    }
    
    max_retries = 5
    retry_count = 0
    
    while retry_count < max_retries:
        try:
            response = requests.get(
                'https://api.spotify.com/v1/search',
                headers=headers,
                params=params,
                timeout=10
            )
            
            # CRITICAL FIX: Respect Retry-After header
            if response.status_code == 429:
                retry_after = int(response.headers.get("Retry-After", 1))
                print(f"   ⏳ Rate limited. Waiting {retry_after}s as instructed by Spotify...")
                time.sleep(retry_after)
                retry_count += 1
                continue  # Retry the SAME request
            
            # Other errors - return None (genuine failure)
            if response.status_code != 200:
                return None
            
            data = response.json()
            artists = data.get('artists', {}).get('items', [])
            
            # No results found - this is a real "not found"
            if not artists:
                return None
            
            # IMPROVEMENT: Pick best match instead of first result
            best_match = max(
                artists,
                key=lambda a: SequenceMatcher(
                    None,
                    artist_name.lower(),
                    a.get('name', '').lower()
                ).ratio()
            )
            
            return {
                'spotify_id': best_match.get('id'),
                'spotify_name': best_match.get('name'),
                'spotify_url': best_match.get('external_urls', {}).get('spotify'),
                'followers': best_match.get('followers', {}).get('total'),
                'popularity': best_match.get('popularity'),
                'genres': ', '.join(best_match.get('genres', [])),
                'match_confidence': calculate_confidence(artist_name, best_match.get('name', ''))
            }
        
        except Exception as e:
            print(f"   ⚠️  Error searching for {artist_name}: {e}")
            retry_count += 1
            if retry_count < max_retries:
                time.sleep(1)
                continue
            return None
    
    # Max retries exceeded
    print(f"   ❌ Failed to fetch {artist_name} after {max_retries} retries")
    return None

# ============================================
# STEP 4: Main Processing Loop
# ============================================
def main():
    print("=" * 60)
    print("🎵 SPOTIFY ARTIST MATCHER - FIXED")
    print("=" * 60)
    
    # Get access token
    print("\n1. Authenticating with Spotify...")
    try:
        access_token = get_access_token()
        token_created_at = time.time()
        print("✅ Successfully authenticated")
    except Exception as e:
        print(f"❌ Failed to authenticate: {e}")
        exit(1)
    
    # Load artists
    print(f"\n2. Loading artists from {INPUT_FILE}...")
    try:
        df = pd.read_csv(INPUT_FILE)
        total = len(df)
        print(f"✅ Loaded {total} artists")
        
        # OPTIMIZATION: Deduplicate artists
        original_count = len(df)
        df['artist_name_clean'] = df['artist_name'].str.lower().str.strip()
        df = df.drop_duplicates(subset=['artist_name_clean'], keep='first')
        df = df.drop(columns=['artist_name_clean'])
        
        if len(df) < original_count:
            print(f"✅ Removed {original_count - len(df)} duplicate artists")
            total = len(df)
        
        # Check if we have a progress file to resume from
        progress_file = 'spotify_matches_progress.csv'
        try:
            progress_df = pd.read_csv(progress_file)
            completed_ids = set(progress_df['artist_id'].tolist())
            df = df[~df['artist_id'].isin(completed_ids)]
            
            if len(completed_ids) > 0:
                print(f"ℹ️  Found progress file with {len(completed_ids)} completed artists")
                print(f"ℹ️  Resuming with {len(df)} remaining artists")
                existing_results = progress_df.to_dict('records')
            else:
                existing_results = []
        except FileNotFoundError:
            existing_results = []
            print(f"ℹ️  No progress file found, starting fresh")
            
    except FileNotFoundError:
        print(f"❌ ERROR: Could not find {INPUT_FILE}")
        print("Make sure you export your artist_id and artist_name columns to this file.")
        exit(1)
    except Exception as e:
        print(f"❌ ERROR loading CSV: {e}")
        exit(1)
    
    # Validate CSV columns
    if 'artist_id' not in df.columns or 'artist_name' not in df.columns:
        print("❌ ERROR: CSV must have 'artist_id' and 'artist_name' columns")
        exit(1)
    
    # Process each artist
    print(f"\n3. Searching Spotify for {len(df)} artists...")
    print(f"   📊 Estimated time: {len(df) * 0.15 / 60:.0f} minutes (~10 requests/sec)")
    print("   🛡️  Improvements:")
    print("      • Respects Retry-After headers")
    print("      • Better query precision (artist:\"name\")")
    print("      • Picks best match from top 5 results")
    print("      • Reactive throttling (not static delays)")
    results = existing_results.copy()
    
    start_time = time.time()
    request_count = 0
    
    for idx, row in df.iterrows():
        artist_id = row['artist_id']
        artist_name = row['artist_name']
        
        # Refresh token if it's been more than 50 minutes
        if time.time() - token_created_at > 3000:  # 50 minutes
            print("   🔄 Refreshing access token...")
            access_token = get_access_token()
            token_created_at = time.time()
            print("   ✅ Token refreshed")
        
        # Search Spotify with proper retry logic
        result = search_spotify_artist(artist_name, access_token)
        request_count += 1
        
        if result:
            # Successfully found
            results.append({
                'artist_id': artist_id,
                'artist_name': artist_name,
                'spotify_id': result['spotify_id'],
                'spotify_name': result['spotify_name'],
                'spotify_url': result['spotify_url'],
                'followers': result['followers'],
                'popularity': result['popularity'],
                'genres': result['genres'],
                'match_confidence': result['match_confidence'],
                'action': 'auto_accept' if result['match_confidence'] in ['exact', 'high'] else 'review'
            })
        else:
            # Genuinely not found (after retries)
            results.append({
                'artist_id': artist_id,
                'artist_name': artist_name,
                'spotify_id': None,
                'spotify_name': None,
                'spotify_url': None,
                'followers': None,
                'popularity': None,
                'genres': None,
                'match_confidence': 'not_found',
                'action': 'review'
            })
        
        # Small baseline delay (~10 requests/sec max)
        time.sleep(0.1)
        
        # Progress indicator every 50 artists
        if (idx + 1) % 50 == 0:
            elapsed = time.time() - start_time
            rate = request_count / elapsed
            remaining = (len(df) - idx - 1) / rate
            total_completed = len(existing_results) + idx + 1
            print(f"   Progress: {total_completed}/{total} ({total_completed/total*100:.1f}%) - Rate: {rate:.1f} req/s - ETA: {remaining/60:.1f} min")
        
        # Save progress every 100 artists
        if (idx + 1) % 100 == 0:
            pd.DataFrame(results).to_csv('spotify_matches_progress.csv', index=False)
    
    # Final save
    print(f"\n4. Saving results to {OUTPUT_FILE}...")
    results_df = pd.DataFrame(results)
    results_df.to_csv(OUTPUT_FILE, index=False)
    
    # Summary statistics
    print("\n" + "=" * 60)
    print("✅ MATCHING COMPLETE!")
    print("=" * 60)
    
    exact = len(results_df[results_df['match_confidence'] == 'exact'])
    high = len(results_df[results_df['match_confidence'] == 'high'])
    medium = len(results_df[results_df['match_confidence'] == 'medium'])
    low = len(results_df[results_df['match_confidence'] == 'low'])
    not_found = len(results_df[results_df['match_confidence'] == 'not_found'])
    
    print(f"\nTotal artists processed: {len(results_df)}")
    print(f"  ✅ Exact matches: {exact} ({exact/len(results_df)*100:.1f}%)")
    print(f"  ✅ High confidence: {high} ({high/len(results_df)*100:.1f}%)")
    print(f"  ⚠️  Medium confidence: {medium} ({medium/len(results_df)*100:.1f}%)")
    print(f"  ⚠️  Low confidence: {low} ({low/len(results_df)*100:.1f}%)")
    print(f"  ❌ Not found: {not_found} ({not_found/len(results_df)*100:.1f}%)")
    
    auto_accept = len(results_df[results_df['action'] == 'auto_accept'])
    review = len(results_df[results_df['action'] == 'review'])
    
    print(f"\n📊 Summary:")
    print(f"  Auto-accepted: {auto_accept} ({auto_accept/len(results_df)*100:.1f}%)")
    print(f"  Need review: {review} ({review/len(results_df)*100:.1f}%)")
    
    elapsed_total = time.time() - start_time
    avg_rate = request_count / elapsed_total
    print(f"\n⚡ Performance:")
    print(f"  Total time: {elapsed_total/60:.1f} minutes")
    print(f"  Average rate: {avg_rate:.2f} requests/second")
    
    print(f"\n📝 Next steps:")
    print(f"  1. Open {OUTPUT_FILE} in Excel")
    print(f"  2. Review rows where action = 'review'")
    print(f"  3. Run merge_spotify_data.py to combine with dim_artist.csv")
    
    print("\n" + "=" * 60)

if __name__ == "__main__":
    main()
