using System.Threading.Channels;
using Microsoft.Extensions.Options;

namespace LogHub.Api.Features.Ingestion;

/// <summary>
/// In-memory queue between the ingestion endpoint and <see cref="EventWriter"/>,
/// bounded by the number of events waiting (Ingestion:MaxQueuedEvents), not by requests, so memory stays bounded.
/// </summary>
public sealed class EventQueue(IOptions<IngestionOptions> options)
{
    private readonly Channel<IngestionBatch> channel = Channel.CreateUnbounded<IngestionBatch>(new UnboundedChannelOptions { SingleReader = true });
    private long pendingEvents;

    public ChannelReader<IngestionBatch> Reader => channel.Reader;

    public long PendingEvents => Interlocked.Read(ref pendingEvents);

    /// <summary>False when the queue is full or closed: the caller answers 503 and the client retries.</summary>
    public bool TryEnqueue(IngestionBatch batch)
    {
        var count = batch.Events.Count;
        var total = Interlocked.Add(ref pendingEvents, count);

        // A single batch larger than the limit is accepted when the queue is empty, otherwise it could never get in.
        if ((total > options.Value.MaxQueuedEvents && total != count) || !channel.Writer.TryWrite(batch))
        {
            Interlocked.Add(ref pendingEvents, -count);
            return false;
        }

        return true;
    }

    /// <summary>Called by the writer once events left memory (written or dropped).</summary>
    public void Release(int count) => Interlocked.Add(ref pendingEvents, -count);

    public void Complete() => channel.Writer.TryComplete();
}
