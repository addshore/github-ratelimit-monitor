import subprocess
import csv
import time
from datetime import datetime, timedelta
import plotext as plt
import os

# Configuration
INTERVAL_SECONDS = 10
CSV_FILENAME = 'rate_limit_log.csv'

# In-memory storage
history_times = []
history_limits = []

# 1. Load existing CSV if it exists
if os.path.exists(CSV_FILENAME):
    print(f"Loading existing data from {CSV_FILENAME}...")
    with open(CSV_FILENAME, 'r') as f:
        reader = csv.reader(f)
        next(reader, None)  # Skip the header row
        for row in reader:
            if len(row) == 2:
                try:
                    # Parse the exact format we save it in
                    dt = datetime.strptime(row[0], '%Y-%m-%d %H:%M:%S')
                    limit = int(row[1])
                    history_times.append(dt)
                    history_limits.append(limit)
                except ValueError:
                    pass # Ignore any malformed rows

# 2. If the file didn't exist, create it and write the header
else:
    with open(CSV_FILENAME, 'w', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(['Timestamp', 'Remaining Requests'])

print(f"Tracking GitHub rate limits every {INTERVAL_SECONDS} seconds...")
print("Showing the last 2 hours of data. Press Ctrl+C to stop.")
time.sleep(2) # Brief pause so you can read the intro

try:
    while True:
        # Ask the gh CLI for the core remaining limit
        result = subprocess.run(
            ['gh', 'api', '/rate_limit', '--jq', '.resources.core.remaining'],
            capture_output=True, text=True
        )
        
        if result.returncode == 0 and result.stdout.strip().isdigit():
            remaining = int(result.stdout.strip())
            now = datetime.now()
            
            # Append new data to memory
            history_times.append(now)
            history_limits.append(remaining)
            
            # Append to CSV (we keep ALL data in the CSV)
            with open(CSV_FILENAME, 'a', newline='') as f:
                writer = csv.writer(f)
                writer.writerow([now.strftime('%Y-%m-%d %H:%M:%S'), remaining])
                
            # Filter memory arrays for the plot (last 2 hours only)
            cutoff_time = now - timedelta(hours=2)
            plot_times = []
            plot_limits = []
            
            for t, l in zip(history_times, history_limits):
                if t >= cutoff_time:
                    # Convert datetime back to string format for plotext X-axis
                    plot_times.append(t.strftime('%H:%M:%S'))
                    plot_limits.append(l)
            
            # Clear the terminal screen (works on Windows/Mac/Linux)
            os.system('cls' if os.name == 'nt' else 'clear')
            
            # Build and show the terminal plot
            plt.clear_figure()
            
            # Tell plotext the exact format of our X-axis strings
            plt.date_form('H:M:S')
            
            plt.plot(plot_times, plot_limits, marker="dot", color="cyan")
            plt.title("Live GitHub Core Rate Limit Drain (Last 2 Hours)")
            plt.xlabel("Time")
            plt.ylabel("Requests Remaining")
            
            # Dynamic scaling
            if plot_limits:
                plt.ylim(max(0, min(plot_limits) - 100), max(5000, max(plot_limits) + 100))
            
            plt.show()
            
            print(f"\nLatest check at {now.strftime('%H:%M:%S')}: {remaining} requests remaining.")
            print("Press Ctrl+C to stop tracking.")
            
        else:
            print("Error fetching rate limit. Is the gh CLI authenticated?")
            
        # Wait before checking again
        time.sleep(INTERVAL_SECONDS)

except KeyboardInterrupt:
    print("\nTracking stopped by user. Your full history is safely saved in rate_limit_log.csv.")